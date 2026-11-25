//! Suporte a controle de um jogo pelo nome, na loja da Steam.
//!
//! A Epic nem sempre marca o suporte a controle dos jogos dela. Quando o mesmo jogo existe na loja da Steam, a Steam sabe
//! (categorias "Suporte completo a controle" e "Suporte parcial a controle"). A busca é pública, sem chave nem conta: acha o
//! jogo pelo nome (só vale quando o nome combina) e lê as categorias dele.

use std::collections::HashMap;
use std::time::Duration;

const SEARCH: &str = "https://store.steampowered.com/api/storesearch/";
const DETAILS: &str = "https://store.steampowered.com/api/appdetails";
/// Pausa entre pedidos: a loja limita uns 200 pedidos a cada 5 minutos.
const PAUSE: Duration = Duration::from_millis(800);

/// Palavras de edição que não mudam de jogo ("Control Ultimate Edition" = "Control").
const EDITION_WORDS: &[&str] = &[
    "standard", "deluxe", "digital", "premium", "ultimate", "complete", "definitive", "gold", "special", "goty", "edition", "bundle", "collectors", "directors", "cut",
];

/// Título comparável: minúsculas, sem marcas, pontuação nem palavras de edição.
pub fn normalize(title: &str) -> String {
    let lowered: String = title
        .chars()
        .filter(|c| !matches!(c, '™' | '®' | '©'))
        .flat_map(|c| c.to_lowercase())
        .map(|c| match c {
            'á' | 'à' | 'â' | 'ã' | 'ä' => 'a',
            'é' | 'è' | 'ê' | 'ë' => 'e',
            'í' | 'ì' | 'î' | 'ï' => 'i',
            'ó' | 'ò' | 'ô' | 'õ' | 'ö' => 'o',
            'ú' | 'ù' | 'û' | 'ü' => 'u',
            'ç' => 'c',
            other => other,
        })
        .collect::<String>()
        .replace('&', " and ")
        .replace("game of the year", " ");
    lowered
        .split(|c: char| !c.is_alphanumeric())
        .filter(|word| !word.is_empty() && !EDITION_WORDS.contains(word))
        .collect::<Vec<_>>()
        .join(" ")
}

fn encode(text: &str) -> String {
    let mut out = String::new();
    for b in text.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => out.push(b as char),
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

/// O AppID do jogo da Steam cujo nome combina com o título (ou `None`).
pub fn find_app(search_json: &str, title: &str) -> Option<u64> {
    let value: serde_json::Value = serde_json::from_str(search_json).ok()?;
    let wanted = normalize(title);
    if wanted.is_empty() {
        return None;
    }
    value.get("items")?.as_array()?.iter().find_map(|item| {
        let is_app = item.get("type").and_then(|v| v.as_str()).is_none_or(|t| t == "app");
        let name = item.get("name").and_then(|v| v.as_str())?;
        (is_app && normalize(name) == wanted).then(|| item.get("id").and_then(|v| v.as_u64())).flatten()
    })
}

/// "full", "partial" ou "none" a partir das categorias de `appdetails`.
pub fn support_from_details(details_json: &str, app_id: u64) -> Option<&'static str> {
    let value: serde_json::Value = serde_json::from_str(details_json).ok()?;
    let entry = value.get(app_id.to_string())?;
    if entry.get("success").and_then(|v| v.as_bool()) != Some(true) {
        return None;
    }
    let ids: Vec<u64> = entry.get("data")?.get("categories")?.as_array()?.iter().filter_map(|c| c.get("id").and_then(|v| v.as_u64())).collect();
    Some(if ids.contains(&28) {
        "full"
    } else if ids.contains(&18) {
        "partial"
    } else {
        "none"
    })
}

/// "full", "partial", "none" (achou o jogo, sem suporte) ou "nomatch" (a Steam não tem um jogo com esse nome).
fn lookup(title: &str) -> Result<&'static str, String> {
    let term = title.chars().filter(|c| !matches!(c, '™' | '®' | '©')).collect::<String>();
    let search = crate::steam::http_get(&format!("{SEARCH}?term={}&l=english&cc=us", encode(term.trim())))?;
    let Some(app_id) = find_app(&search, title) else { return Ok("nomatch") };
    std::thread::sleep(PAUSE);
    let details = crate::steam::http_get(&format!("{DETAILS}?appids={app_id}&filters=categories&cc=us"))?;
    support_from_details(&details, app_id).ok_or_else(|| "A loja da Steam não devolveu as categorias.".to_string())
}

/// Consulta cada título (no máximo 12 por vez, com pausa entre os pedidos). Títulos cuja consulta falhou ficam de fora da
/// resposta, para serem tentados de novo mais tarde.
pub fn controller_support(titles: Vec<String>) -> HashMap<String, String> {
    let mut out = HashMap::new();
    for title in titles.into_iter().take(12) {
        if let Ok(support) = lookup(&title) {
            out.insert(title, support.to_string());
        }
        std::thread::sleep(PAUSE);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normaliza_como_o_front() {
        assert_eq!(normalize("CONTROL Ultimate Edition"), "control");
        assert_eq!(normalize("The Witcher® 3: Wild Hunt - Game of the Year Edition"), "the witcher 3 wild hunt");
        assert_eq!(normalize("Café & Cream™"), "cafe and cream");
    }

    #[test]
    fn acha_o_app_pelo_nome() {
        let json = r#"{"total":3,"items":[
            {"type":"app","name":"Control Soundtrack","id":1},
            {"type":"app","name":"CONTROL Ultimate Edition","id":870780},
            {"type":"dlc","name":"Control","id":2}]}"#;
        assert_eq!(find_app(json, "Control"), Some(870780));
        assert_eq!(find_app(json, "Outro jogo"), None);
        assert_eq!(find_app("não é json", "Control"), None);
    }

    #[test]
    fn le_as_categorias_de_controle() {
        let full = r#"{"870780":{"success":true,"data":{"categories":[{"id":2},{"id":28}]}}}"#;
        let partial = r#"{"1":{"success":true,"data":{"categories":[{"id":18}]}}}"#;
        let none = r#"{"2":{"success":true,"data":{"categories":[{"id":2}]}}}"#;
        let failed = r#"{"3":{"success":false}}"#;
        assert_eq!(support_from_details(full, 870780), Some("full"));
        assert_eq!(support_from_details(partial, 1), Some("partial"));
        assert_eq!(support_from_details(none, 2), Some("none"));
        assert_eq!(support_from_details(failed, 3), None);
    }

    #[test]
    #[ignore = "consulta a loja da Steam (rede)"]
    fn consulta_real() {
        let found = controller_support(vec!["Control".into(), "Hogwarts Legacy".into(), "Um Jogo Que Nao Existe 123".into()]);
        println!("{found:?}");
        assert_eq!(found.get("Control").map(String::as_str), Some("full"));
        assert_eq!(found.get("Um Jogo Que Nao Existe 123").map(String::as_str), Some("nomatch"));
    }
}
