//! Login na Steam lendo um QR code com o app da Steam no celular (sem digitar e-mail nem senha).
//!
//! É o mesmo caminho que o próprio app da Steam usa: o launcher pede um desafio (`BeginAuthSessionViaQR`), mostra o QR,
//! o jogador o aprova no celular e a Steam entrega um token de renovação. Só esse token é guardado, cifrado com a conta do
//! Windows (DPAPI), e serve para pedir à Steam, quando preciso, um token de acesso à Web API. Senha e código do Steam
//! Guard nunca passam por aqui.

use serde::{Deserialize, Serialize};
use std::io::Write;
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const SESSION_FILE: &str = "steam_session.bin";
const API: &str = "https://api.steampowered.com/IAuthenticationService";

/// Desafio de QR: o que mostrar ao jogador e o que devolver à Steam para saber se ele aprovou.
#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct QrChallenge {
    pub client_id: String,
    pub request_id: String,
    /// Endereço que vai dentro do QR (`https://s.team/q/1/<id>`).
    pub challenge_url: String,
    /// Segundos entre uma pergunta e outra.
    pub interval: f32,
}

/// Resposta de cada pergunta "o jogador já aprovou?".
#[derive(Serialize, Debug, Clone, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct QrPoll {
    /// A Steam trocou o desafio (o QR muda de tempos em tempos): mostre o novo.
    pub new_client_id: Option<String>,
    pub new_challenge_url: Option<String>,
    /// O jogador aprovou: a sessão já foi guardada.
    pub approved: bool,
    pub account_name: Option<String>,
    pub steam_id: Option<String>,
}

/// Quem está logado pelo QR (nunca o token).
#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SessionInfo {
    pub account_name: String,
    pub steam_id: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredSession {
    steam_id: String,
    account_name: String,
    refresh_token: String,
}

// ───────── HTTP ─────────

/// Codifica um texto para o corpo de um formulário (`application/x-www-form-urlencoded`).
fn form_encode(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for b in text.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => out.push(b as char),
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

/// POST com o corpo enviado pela entrada do `curl.exe`, para que tokens não apareçam na linha de comando do processo.
fn post_form(url: &str, body: &str) -> Result<String, String> {
    let mut child = Command::new("curl.exe")
        .args(["-sS", "-m", "25", "-X", "POST", "-H", "Content-Type: application/x-www-form-urlencoded", "--data-binary", "@-", url])
        .creation_flags(CREATE_NO_WINDOW)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Não consegui executar o curl: {e}"))?;
    child.stdin.take().ok_or("Sem entrada para o curl.")?.write_all(body.as_bytes()).map_err(|e| e.to_string())?;
    let out = child.wait_with_output().map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(format!("Falha de rede: {}", String::from_utf8_lossy(&out.stderr).trim()));
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

/// GET em que o endereço vai pela entrada do `curl.exe` (arquivo de configuração `-K -`), para que tokens na URL não
/// apareçam na linha de comando do processo.
fn get_via_stdin(url: &str) -> Result<String, String> {
    let mut child = Command::new("curl.exe")
        .args(["-sS", "-m", "25", "-K", "-"])
        .creation_flags(CREATE_NO_WINDOW)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Não consegui executar o curl: {e}"))?;
    child.stdin.take().ok_or("Sem entrada para o curl.")?.write_all(format!("url = \"{url}\"\n").as_bytes()).map_err(|e| e.to_string())?;
    let out = child.wait_with_output().map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(format!("Falha de rede: {}", String::from_utf8_lossy(&out.stderr).trim()));
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

/// Chama um método do serviço de autenticação com um objeto JSON e devolve o campo `response`.
fn call(method: &str, input: &serde_json::Value) -> Result<serde_json::Value, String> {
    let body = format!("input_json={}", form_encode(&input.to_string()));
    let text = post_form(&format!("{API}/{method}/v1/"), &body)?;
    let value: serde_json::Value = serde_json::from_str(&text).map_err(|_| "A Steam não respondeu como esperado. Tente de novo.".to_string())?;
    value.get("response").cloned().ok_or_else(|| "A Steam não respondeu como esperado. Tente de novo.".to_string())
}

fn str_of(value: &serde_json::Value, key: &str) -> Option<String> {
    value.get(key).and_then(|v| v.as_str()).map(str::to_string).filter(|s| !s.is_empty())
}

// ───────── Login por QR ─────────

/// Pede um desafio novo. Tipo de plataforma 2 (navegador): o token serve à Web API e à loja.
pub fn begin() -> Result<QrChallenge, String> {
    let r = call("BeginAuthSessionViaQR", &serde_json::json!({ "device_friendly_name": "Console Launcher", "platform_type": 2 }))?;
    Ok(QrChallenge {
        client_id: str_of(&r, "client_id").ok_or("A Steam não devolveu o QR.")?,
        request_id: str_of(&r, "request_id").ok_or("A Steam não devolveu o QR.")?,
        challenge_url: str_of(&r, "challenge_url").ok_or("A Steam não devolveu o QR.")?,
        interval: r.get("interval").and_then(|v| v.as_f64()).unwrap_or(5.0) as f32,
    })
}

/// Pergunta se o jogador já aprovou. Aprovado: guarda a sessão (cifrada) e devolve só quem entrou.
pub fn poll(dir: &Path, client_id: &str, request_id: &str) -> Result<QrPoll, String> {
    let r = call("PollAuthSessionStatus", &serde_json::json!({ "client_id": client_id, "request_id": request_id }))?;
    let mut poll = QrPoll { new_client_id: str_of(&r, "new_client_id"), new_challenge_url: str_of(&r, "new_challenge_url"), ..QrPoll::default() };
    if let Some(refresh) = str_of(&r, "refresh_token") {
        let steam_id = steam_id_of_token(&refresh).ok_or("A Steam devolveu um token que não consegui ler.")?;
        let account_name = str_of(&r, "account_name").unwrap_or_default();
        save_session(dir, &StoredSession { steam_id: steam_id.clone(), account_name: account_name.clone(), refresh_token: refresh })?;
        poll.approved = true;
        poll.account_name = Some(account_name);
        poll.steam_id = Some(steam_id);
    }
    Ok(poll)
}

/// Quem está logado pelo QR neste PC, se alguém estiver.
pub fn session_info(dir: &Path) -> Option<SessionInfo> {
    load_session(dir).map(|s| SessionInfo { account_name: s.account_name, steam_id: s.steam_id })
}

/// Esquece a sessão deste PC (o token guardado deixa de existir aqui).
pub fn logout(dir: &Path) -> Result<(), String> {
    match std::fs::remove_file(dir.join(SESSION_FILE)) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

/// POST de formulário com cabeçalhos extras; devolve (cabeçalhos da resposta, corpo). O corpo vai pela entrada do `curl.exe`.
fn post_with_headers(url: &str, body: &str, headers: &[String]) -> Result<(String, String), String> {
    let mut args: Vec<String> = ["-sS", "-i", "-m", "25", "-X", "POST", "-H", "Content-Type: application/x-www-form-urlencoded"].map(String::from).into();
    for header in headers {
        args.push("-H".into());
        args.push(header.clone());
    }
    args.extend(["--data-binary".into(), "@-".into(), url.into()]);
    let mut child = Command::new("curl.exe")
        .args(&args)
        .creation_flags(CREATE_NO_WINDOW)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Não consegui executar o curl: {e}"))?;
    child.stdin.take().ok_or("Sem entrada para o curl.")?.write_all(body.as_bytes()).map_err(|e| e.to_string())?;
    let out = child.wait_with_output().map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(format!("Falha de rede: {}", String::from_utf8_lossy(&out.stderr).trim()));
    }
    let text = String::from_utf8_lossy(&out.stdout).into_owned();
    // Com respostas "100 Continue" ou redirecionamentos o curl imprime mais de um bloco de cabeçalhos: vale o último.
    let mut rest = text.as_str();
    while let Some((head, tail)) = rest.split_once("\r\n\r\n") {
        if tail.starts_with("HTTP/") {
            rest = tail;
        } else {
            return Ok((head.to_string(), tail.to_string()));
        }
    }
    Ok((rest.to_string(), String::new()))
}

/// Valor de um cookie entre os `Set-Cookie` dos cabeçalhos de uma resposta.
fn cookie_value(headers: &str, name: &str) -> Option<String> {
    let prefix = format!("{name}=");
    headers.lines().find_map(|line| {
        let (key, value) = line.split_once(':')?;
        if !key.eq_ignore_ascii_case("set-cookie") {
            return None;
        }
        value.trim().strip_prefix(&prefix)?.split(';').next().map(str::to_string)
    })
}

/// Texto de uma sessão da web (CSRF dos formulários da Steam): qualquer valor hexadecimal serve, desde que o cookie e o
/// formulário tragam o mesmo.
fn web_session_id() -> String {
    let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    format!("{:024x}", nanos ^ ((std::process::id() as u128) << 64))
}

/// Decodifica `%XX` (os cookies da Steam trazem `||` como `%7C%7C`).
fn percent_decode(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Some(v) = std::str::from_utf8(&bytes[i + 1..i + 3]).ok().and_then(|h| u8::from_str_radix(h, 16).ok()) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Token de acesso à Web API a partir do token de renovação guardado.
///
/// O token do QR é do tipo "web": a Steam recusa `GenerateAccessTokenForApp` para ele (resultado 15, acesso negado).
/// O caminho dos tokens web é o do próprio site: o token vira os cookies da comunidade (`jwt/finalizelogin` e
/// `settoken`) e o cookie `steamLoginSecure` traz o token de acesso (`<steamid>||<token>`).
fn access_token(dir: &Path) -> Result<(String, String), String> {
    let session = load_session(dir).ok_or("Você não está logado pelo QR.")?;
    let expired = || "A sessão expirou. Entre de novo com o QR code.".to_string();
    let sid = web_session_id();
    let site = [
        format!("Cookie: sessionid={sid}"),
        "Origin: https://steamcommunity.com".to_string(),
        "Referer: https://steamcommunity.com/".to_string(),
    ];

    let body = format!("nonce={}&sessionid={sid}&redir={}", form_encode(&session.refresh_token), form_encode("https://steamcommunity.com/login/home/?goto="));
    let (_, text) = post_with_headers("https://login.steampowered.com/jwt/finalizelogin", &body, &site)?;
    let login: serde_json::Value = serde_json::from_str(&text).map_err(|_| "A Steam não respondeu como esperado. Tente de novo.".to_string())?;
    let transfers = login.get("transfer_info").and_then(|t| t.as_array()).ok_or_else(expired)?;
    let transfer = transfers
        .iter()
        .find(|t| t.get("url").and_then(|u| u.as_str()).is_some_and(|u| u.contains("steamcommunity.com")))
        .ok_or_else(expired)?;
    let url = transfer.get("url").and_then(|u| u.as_str()).ok_or_else(expired)?;
    let params = transfer.get("params").ok_or_else(expired)?;
    let steam_id = login.get("steamID").and_then(|v| v.as_str()).map(str::to_string).unwrap_or_else(|| session.steam_id.clone());
    let body = format!(
        "nonce={}&auth={}&steamID={}&sessionid={sid}",
        form_encode(&str_of(params, "nonce").ok_or_else(expired)?),
        form_encode(&str_of(params, "auth").ok_or_else(expired)?),
        form_encode(&steam_id)
    );
    let (headers, _) = post_with_headers(url, &body, &site)?;
    let cookie = percent_decode(&cookie_value(&headers, "steamLoginSecure").ok_or_else(expired)?);
    let token = cookie.split_once("||").map(|(_, token)| token.to_string()).ok_or_else(expired)?;
    Ok((token, session.steam_id))
}

/// Jogos da conta logada pelo QR, com o token de acesso (sem chave de API).
pub fn fetch_owned(dir: &Path, steam_id: &str) -> Result<Vec<crate::steam::OwnedGame>, String> {
    let (token, session_id) = access_token(dir)?;
    if session_id != steam_id {
        return Err("A conta do QR não é a que está logada na Steam deste PC.".into());
    }
    // Esta chamada só aceita GET. O endereço (com o token) vai pela entrada do curl, não pela linha de comando.
    let url = format!(
        "https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?access_token={}&steamid={}&include_appinfo=1&include_played_free_games=1&format=json",
        form_encode(&token),
        form_encode(steam_id)
    );
    let text = get_via_stdin(&url)?;
    crate::steam::parse_owned_json(&text).map_err(|_| "A Steam não retornou os jogos desta conta. Entre de novo com o QR code.".to_string())
}

// ───────── Token ─────────

/// O número da conta (SteamID64) está no campo `sub` do token (um JWT).
fn steam_id_of_token(token: &str) -> Option<String> {
    let payload = token.split('.').nth(1)?;
    let bytes = base64url_decode(payload)?;
    let json: serde_json::Value = serde_json::from_slice(&bytes).ok()?;
    json.get("sub")?.as_str().map(str::to_string)
}

fn base64url_decode(text: &str) -> Option<Vec<u8>> {
    let mut out = Vec::with_capacity(text.len() * 3 / 4);
    let (mut buffer, mut bits) = (0u32, 0u32);
    for c in text.bytes() {
        let value = match c {
            b'A'..=b'Z' => c - b'A',
            b'a'..=b'z' => c - b'a' + 26,
            b'0'..=b'9' => c - b'0' + 52,
            b'-' | b'+' => 62,
            b'_' | b'/' => 63,
            b'=' => break,
            _ => return None,
        };
        buffer = (buffer << 6) | value as u32;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((buffer >> bits) as u8);
            buffer &= (1 << bits) - 1;
        }
    }
    Some(out)
}

// ───────── Armazenamento cifrado (DPAPI: só esta conta do Windows, neste PC, lê o arquivo) ─────────

fn session_path(dir: &Path) -> PathBuf {
    dir.join(SESSION_FILE)
}

pub(crate) fn protect(data: &[u8]) -> Result<Vec<u8>, String> {
    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Cryptography::{CryptProtectData, CRYPT_INTEGER_BLOB};
    let input = CRYPT_INTEGER_BLOB { cbData: data.len() as u32, pbData: data.as_ptr() as *mut u8 };
    let mut output = CRYPT_INTEGER_BLOB { cbData: 0, pbData: std::ptr::null_mut() };
    // SAFETY: a entrada vive durante a chamada; a saída é copiada e liberada com LocalFree, como a API manda.
    unsafe {
        if CryptProtectData(&input, std::ptr::null(), std::ptr::null(), std::ptr::null(), std::ptr::null(), 0, &mut output) == 0 {
            return Err("Não consegui proteger a sessão no Windows.".into());
        }
        let bytes = std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
        LocalFree(output.pbData as _);
        Ok(bytes)
    }
}

pub(crate) fn unprotect(data: &[u8]) -> Option<Vec<u8>> {
    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Cryptography::{CryptUnprotectData, CRYPT_INTEGER_BLOB};
    let input = CRYPT_INTEGER_BLOB { cbData: data.len() as u32, pbData: data.as_ptr() as *mut u8 };
    let mut output = CRYPT_INTEGER_BLOB { cbData: 0, pbData: std::ptr::null_mut() };
    // SAFETY: idem `protect`.
    unsafe {
        if CryptUnprotectData(&input, std::ptr::null_mut(), std::ptr::null(), std::ptr::null(), std::ptr::null(), 0, &mut output) == 0 {
            return None;
        }
        let bytes = std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
        LocalFree(output.pbData as _);
        Some(bytes)
    }
}

fn save_session(dir: &Path, session: &StoredSession) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let json = serde_json::to_vec(session).map_err(|e| e.to_string())?;
    std::fs::write(session_path(dir), protect(&json)?).map_err(|e| e.to_string())
}

fn load_session(dir: &Path) -> Option<StoredSession> {
    let raw = std::fs::read(session_path(dir)).ok()?;
    serde_json::from_slice(&unprotect(&raw)?).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codifica_formulario() {
        assert_eq!(form_encode(r#"{"a":"b c"}"#), "%7B%22a%22%3A%22b%20c%22%7D");
        assert_eq!(form_encode("abc-_.~123"), "abc-_.~123");
    }

    #[test]
    fn extrai_o_token_de_acesso_do_cookie_da_comunidade() {
        let headers = "HTTP/1.1 200 OK\r\nSet-Cookie: sessionid=abc; Path=/\r\nset-cookie: steamLoginSecure=7656%7C%7Ceyj.corpo.assinatura; Path=/; Secure\r\nContent-Length: 0";
        let cookie = percent_decode(&cookie_value(headers, "steamLoginSecure").unwrap());
        assert_eq!(cookie, "7656||eyj.corpo.assinatura");
        assert_eq!(cookie.split_once("||").map(|(_, t)| t), Some("eyj.corpo.assinatura"));
        assert!(cookie_value(headers, "outro").is_none());
        assert_eq!(percent_decode("a%2Fb%zz%"), "a/b%zz%");
    }

    #[test]
    fn le_o_numero_da_conta_do_token() {
        // payload: {"sub":"76561198000000042","aud":["web"]}
        let token = "eyJhbGciOiJFZERTQSJ9.eyJzdWIiOiI3NjU2MTE5ODAwMDAwMDA0MiIsImF1ZCI6WyJ3ZWIiXX0.assinatura";
        assert_eq!(steam_id_of_token(token).as_deref(), Some("76561198000000042"));
        assert_eq!(steam_id_of_token("sem-pontos"), None);
    }

    #[test]
    fn sessao_guardada_cifrada_e_lida_de_volta() {
        let dir = std::env::temp_dir().join(format!("launcher-auth-teste-{}", std::process::id()));
        let session = StoredSession { steam_id: "76561198000000000".into(), account_name: "conta".into(), refresh_token: "segredo-do-token".into() };
        save_session(&dir, &session).unwrap();
        let raw = std::fs::read(dir.join(SESSION_FILE)).unwrap();
        assert!(!String::from_utf8_lossy(&raw).contains("segredo-do-token"), "o token não pode ficar em texto puro");
        assert_eq!(session_info(&dir).unwrap().steam_id, "76561198000000000");
        logout(&dir).unwrap();
        assert!(session_info(&dir).is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn login_por_qr_conta_como_conta_configurada() {
        let dir = std::env::temp_dir().join(format!("launcher-auth-status-{}", std::process::id()));
        let session = StoredSession { steam_id: "76561198000000001".into(), account_name: "conta".into(), refresh_token: "token".into() };
        save_session(&dir, &session).unwrap();
        // Só a conta do QR fica configurada; outra conta (sem chave) continua sem configuração.
        let status = crate::steam::key_status(Some(dir.clone()), "76561198000000001");
        assert!(status.configured);
        assert_eq!(status.session.as_ref().map(|s| s.account_name.as_str()), Some("conta"));
        let other = crate::steam::key_status(Some(dir.clone()), "76561198000000002");
        if !other.from_env {
            assert!(!other.configured && other.session.is_none());
        }
        logout(&dir).unwrap();
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Manual: usa a sessão por QR que o app guardou neste PC e lista os jogos da conta (imprime só números e erros).
    #[test]
    #[ignore]
    fn lista_os_jogos_da_sessao_guardada() {
        let dir = PathBuf::from(std::env::var("APPDATA").unwrap()).join("app.launcher.desktop");
        let info = session_info(&dir).expect("sem sessão guardada: entre pelo QR no app primeiro");
        println!("sessão de {}", info.account_name);
        match fetch_owned(&dir, &info.steam_id) {
            Ok(games) => println!("OK: {} jogos ({} com tempo de jogo)", games.len(), games.iter().filter(|g| g.playtime_min > 0).count()),
            Err(e) => panic!("falhou: {e}"),
        }
    }

    #[test]
    #[ignore]
    fn pede_um_desafio_de_qr_na_steam() {
        let challenge = begin().unwrap();
        println!("{challenge:?}");
        assert!(challenge.challenge_url.starts_with("https://s.team/q/"));
    }
}
