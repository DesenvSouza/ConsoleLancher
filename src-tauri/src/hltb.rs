//! Duração dos jogos (HowLongToBeat).
//!
//! A HowLongToBeat NÃO tem API oficial: este módulo usa os mesmos endereços que o site usa para a própria busca
//! (`/api/search/site/init` entrega um token, `/api/search/site` recebe a pergunta). Eles podem mudar ou passar a recusar programas
//! a qualquer momento; por isso tudo aqui falha com calma (um erro curto) e quem chama trata a duração como extra
//! opcional. Pedimos pouco (uma busca por jogo, com cache no frontend), nos identificamos como "Launcher" e não
//! tentamos contornar nenhum bloqueio.

use serde::Serialize;
use std::io::Write;
use std::os::windows::process::CommandExt;
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const BASE: &str = "https://howlongtobeat.com";
const USER_AGENT: &str = "Launcher/1.0 (consulta pessoal de duracao de jogos)";
/// O token do site dura pouco; reaproveitar por alguns minutos evita uma chamada a mais por jogo.
const TOKEN_TTL: Duration = Duration::from_secs(20 * 60);

/// Duração de um jogo em minutos (`None` = a HowLongToBeat não tem esse tempo).
#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HltbInfo {
    pub game_id: u64,
    pub name: String,
    /// Só a história principal.
    pub main_min: Option<u32>,
    /// História principal e extras.
    pub extras_min: Option<u32>,
    /// Completista (100%).
    pub completionist_min: Option<u32>,
    /// Página do jogo no site.
    pub url: String,
}

#[derive(Clone)]
struct Token {
    value: String,
    hp_key: Option<String>,
    hp_val: Option<String>,
}

static TOKEN: Mutex<Option<(Instant, Token)>> = Mutex::new(None);

/// Uma chamada HTTP pelo `curl.exe` (já vem no Windows). O corpo vai pela entrada do processo. Devolve (código, corpo).
fn request(method: &str, url: &str, headers: &[String], body: Option<&str>) -> Result<(u16, String), String> {
    let mut args: Vec<String> = ["-sS", "-i", "-m", "20", "-A", USER_AGENT, "-X", method].map(String::from).into();
    for header in headers {
        args.push("-H".into());
        args.push(header.clone());
    }
    if body.is_some() {
        args.extend(["--data-binary".into(), "@-".into()]);
    }
    args.push(url.into());

    let mut child = Command::new("curl.exe")
        .args(&args)
        .creation_flags(CREATE_NO_WINDOW)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Não consegui executar o curl: {e}"))?;
    if let Some(mut stdin) = child.stdin.take() {
        if let Some(body) = body {
            stdin.write_all(body.as_bytes()).map_err(|e| e.to_string())?;
        }
    }
    let out = child.wait_with_output().map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(format!("Falha de rede: {}", String::from_utf8_lossy(&out.stderr).trim()));
    }
    Ok(split_response(&String::from_utf8_lossy(&out.stdout)))
}

/// Separa o código HTTP e o corpo de uma resposta com cabeçalhos (vale o último bloco, se houver "100 Continue").
fn split_response(text: &str) -> (u16, String) {
    let mut rest = text;
    let mut status = 0;
    while rest.starts_with("HTTP/") {
        status = rest.split_whitespace().nth(1).and_then(|s| s.parse().ok()).unwrap_or(0);
        match rest.split_once("\r\n\r\n") {
            Some((_, tail)) => rest = tail,
            None => return (status, String::new()),
        }
    }
    (status, rest.to_string())
}

fn site_headers() -> Vec<String> {
    vec![format!("Origin: {BASE}"), format!("Referer: {BASE}/")]
}

fn fetch_token() -> Result<Token, String> {
    if let Some((at, token)) = TOKEN.lock().unwrap().as_ref() {
        if at.elapsed() < TOKEN_TTL {
            return Ok(token.clone());
        }
    }
    let millis = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
    let (status, body) = request("GET", &format!("{BASE}/api/search/site/init?t={millis}"), &site_headers(), None)?;
    if status != 200 {
        return Err(format!("O site HowLongToBeat não liberou a consulta (código {status})."));
    }
    let json: serde_json::Value = serde_json::from_str(&body).map_err(|_| "O site HowLongToBeat respondeu de um jeito inesperado.".to_string())?;
    let text = |key: &str| json.get(key).and_then(|v| v.as_str()).map(str::to_string).filter(|s| !s.is_empty());
    let token = Token { value: text("token").ok_or("O site HowLongToBeat não entregou o token de consulta.")?, hp_key: text("hpKey"), hp_val: text("hpVal") };
    *TOKEN.lock().unwrap() = Some((Instant::now(), token.clone()));
    Ok(token)
}

/// Texto comparável: minúsculas, sem acentos comuns, sem símbolos (™, ®, :, -, etc.) e sem espaços.
fn normalize(name: &str) -> String {
    name.chars()
        .flat_map(|c| c.to_lowercase())
        .filter(|c| c.is_alphanumeric())
        .collect()
}

/// Palavras da busca (sem símbolos), como o site espera em `searchTerms`.
fn search_terms(name: &str) -> Vec<String> {
    name.split(|c: char| !c.is_alphanumeric())
        .filter(|w| !w.is_empty())
        .map(str::to_string)
        .collect()
}

fn minutes(value: Option<&serde_json::Value>) -> Option<u32> {
    let seconds = value?.as_f64()?;
    (seconds > 0.0).then(|| (seconds / 60.0).round().max(1.0) as u32)
}

fn steam_app_of(game: &serde_json::Value) -> Option<String> {
    match game.get("profile_steam")? {
        serde_json::Value::Number(n) => Some(n.to_string()),
        serde_json::Value::String(s) => Some(s.clone()),
        _ => None,
    }
}

/// Escolhe o jogo certo entre os resultados: primeiro pelo AppID da Steam, depois pelo nome idêntico (sem símbolos).
/// Sem certeza, devolve `None`: melhor não mostrar nada do que mostrar a duração de outro jogo.
fn pick(results: &[serde_json::Value], name: &str, app_id: Option<&str>) -> Option<HltbInfo> {
    let wanted = normalize(name);
    let found = app_id
        .and_then(|id| results.iter().find(|g| steam_app_of(g).as_deref() == Some(id)))
        .or_else(|| results.iter().find(|g| g.get("game_name").and_then(|n| n.as_str()).is_some_and(|n| normalize(n) == wanted)))?;
    let id = found.get("game_id").and_then(|v| v.as_u64()).unwrap_or(0);
    let info = HltbInfo {
        game_id: id,
        name: found.get("game_name").and_then(|n| n.as_str()).unwrap_or(name).to_string(),
        main_min: minutes(found.get("comp_main")),
        extras_min: minutes(found.get("comp_plus")),
        completionist_min: minutes(found.get("comp_100")),
        url: format!("{BASE}/game/{id}"),
    };
    // Um jogo achado mas sem nenhum tempo registrado não ajuda em nada.
    (info.main_min.is_some() || info.extras_min.is_some() || info.completionist_min.is_some()).then_some(info)
}

/// Uma busca com o token dado. Devolve (código HTTP, corpo).
fn search(terms: &[String], token: &Token) -> Result<(u16, String), String> {
    let mut body = serde_json::json!({
        "searchType": "games",
        "searchTerms": terms,
        "searchPage": 1,
        "size": 20,
        "searchOptions": {
            "games": {
                "userId": 0, "platform": "", "sortCategory": "popular", "rangeCategory": "main",
                "rangeTime": { "min": 0, "max": 0 },
                "gameplay": { "perspective": "", "flow": "", "genre": "", "difficulty": "" },
                "rangeYear": { "min": "", "max": "" }, "modifier": ""
            },
            "users": { "sortCategory": "postcount" },
            "lists": { "sortCategory": "follows" },
            "filter": "", "sort": 0, "randomizer": 0
        },
        "useCache": true
    });
    let mut headers = site_headers();
    headers.push("Content-Type: application/json".into());
    headers.push(format!("x-auth-token: {}", token.value));
    if let (Some(key), Some(value)) = (&token.hp_key, &token.hp_val) {
        headers.push(format!("x-hp-key: {key}"));
        headers.push(format!("x-hp-val: {value}"));
        body[key] = serde_json::Value::String(value.clone());
    }
    request("POST", &format!("{BASE}/api/search/site"), &headers, Some(&body.to_string()))
}

/// Busca a duração de um jogo. `Ok(None)` = o site não conhece esse jogo (ou não há tempo registrado).
pub fn lookup(name: &str, app_id: Option<&str>) -> Result<Option<HltbInfo>, String> {
    let terms = search_terms(name);
    if terms.is_empty() {
        return Ok(None);
    }
    let (mut status, mut text) = search(&terms, &fetch_token()?)?;
    if status == 401 || status == 403 {
        // O token venceu: pede outro e tenta mais uma vez (só uma).
        *TOKEN.lock().unwrap() = None;
        (status, text) = search(&terms, &fetch_token()?)?;
    }
    if status != 200 {
        return Err(format!("O site HowLongToBeat recusou a busca (código {status})."));
    }
    let json: serde_json::Value = serde_json::from_str(&text).map_err(|_| "O site HowLongToBeat respondeu de um jeito inesperado.".to_string())?;
    let results = json.get("data").and_then(|d| d.as_array()).ok_or("O site HowLongToBeat respondeu de um jeito inesperado.")?;
    Ok(pick(results, name, app_id))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn sample() -> Vec<serde_json::Value> {
        vec![
            json!({ "game_id": 1, "game_name": "The Witcher 3: Wild Hunt - Blood and Wine", "comp_main": 90000, "comp_plus": 120000, "comp_100": 200000, "profile_steam": 378648 }),
            json!({ "game_id": 10270, "game_name": "The Witcher 3: Wild Hunt", "comp_main": 205200, "comp_plus": 370800, "comp_100": 639000, "profile_steam": 292030 }),
            json!({ "game_id": 3, "game_name": "Sem tempo", "comp_main": 0, "comp_plus": 0, "comp_100": 0, "profile_steam": 0 }),
        ]
    }

    #[test]
    fn escolhe_pelo_appid_da_steam_e_converte_para_minutos() {
        let info = pick(&sample(), "Qualquer nome diferente", Some("292030")).unwrap();
        assert_eq!(info.game_id, 10270);
        assert_eq!(info.main_min, Some(3420)); // 205200 s = 57 h
        assert_eq!(info.extras_min, Some(6180));
        assert_eq!(info.completionist_min, Some(10650));
        assert_eq!(info.url, "https://howlongtobeat.com/game/10270");
    }

    #[test]
    fn sem_appid_casa_pelo_nome_ignorando_simbolos_e_maiusculas() {
        let info = pick(&sample(), "THE WITCHER® 3: Wild Hunt", None).unwrap();
        assert_eq!(info.game_id, 10270);
    }

    #[test]
    fn sem_certeza_nao_mostra_nada() {
        // Nome parecido, mas de outro jogo, e sem AppID: não chuta.
        assert!(pick(&sample(), "The Witcher 3", None).is_none());
        // Achou o jogo, mas ele não tem nenhum tempo registrado.
        assert!(pick(&sample(), "Sem tempo", None).is_none());
        assert!(pick(&[], "Qualquer", Some("1")).is_none());
    }

    #[test]
    fn palavras_da_busca_sem_simbolos() {
        assert_eq!(search_terms("DOOM: The Dark Ages™"), ["DOOM", "The", "Dark", "Ages"]);
        assert!(search_terms("™ ®").is_empty());
    }

    #[test]
    fn separa_codigo_e_corpo_da_resposta() {
        assert_eq!(split_response("HTTP/2 200 \r\ncontent-type: x\r\n\r\n{\"a\":1}"), (200, "{\"a\":1}".to_string()));
        assert_eq!(split_response("HTTP/1.1 100 Continue\r\n\r\nHTTP/1.1 403 Forbidden\r\nx: y\r\n\r\nnegado"), (403, "negado".to_string()));
    }

    /// Manual: consulta o site de verdade (precisa de internet) para os jogos de exemplo e imprime o resultado.
    #[test]
    #[ignore]
    fn consulta_real_ao_site() {
        for (name, app) in [("The Witcher 3: Wild Hunt", Some("292030")), ("Hades", Some("1145360")), ("Jogo que nao existe xyz", None)] {
            println!("{name}: {:?}", lookup(name, app));
        }
    }
}
