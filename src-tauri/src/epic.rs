//! Biblioteca da Epic Games.
//!
//! A Epic não tem uma API oficial para o jogador ler a própria biblioteca. O que existe é a API interna que a própria Epic
//! Games Launcher usa (a mesma de Legendary, Heroic e do plugin da Epic no Playnite): o jogador entra uma vez, o launcher
//! guarda só o token de renovação (cifrado com a conta do Windows, como a sessão da Steam) e pede à Epic a lista de jogos
//! da conta, instalados ou não. Senha e verificação em duas etapas nunca passam por aqui: o login acontece no navegador, no
//! site da Epic, e o jogador só devolve ao launcher o código que o site mostra.
//!
//! Os jogos já instalados vêm dos arquivos da própria Epic Games Launcher (não precisam de login). Para abrir e instalar
//! usa-se o protocolo `com.epicgames.launcher://`, que é o caminho previsto pela Epic.
//!
//! É uma API sem suporte: se a Epic mudar algo, a lista da conta pode falhar. Os jogos instalados continuam funcionando.

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::io::Write;
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use winreg::{enums::HKEY_CURRENT_USER, RegKey};

const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const SESSION_FILE: &str = "epic_session.bin";

/// Credenciais públicas do cliente da Epic Games Launcher (as mesmas que ela e os clientes de código aberto usam).
const CLIENT_ID: &str = "34a02cf8f4414e29b15921876da36f9a";
const CLIENT_SECRET: &str = "daafbccc737745039dffe53d94fc76cf";
const USER_AGENT: &str = "UELauncher/17.0.1-37584233+++Portal+Release-Live Windows/10.0.19043.1.0.64bit";
const TOKEN_URL: &str = "https://account-public-service-prod03.ol.epicgames.com/account/api/oauth/token";
const LIBRARY_URL: &str = "https://library-service.live.use1a.on.epicgames.com/library/api/public/items";
const CATALOG_URL: &str = "https://catalog-public-service-prod06.ol.epicgames.com/catalog/api/shared/namespace";
// Tag "Controller Support" no catálogo de tags da Epic.
const CONTROLLER_TAG: u64 = 9549;

// ───────── Tipos ─────────

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EpicStatus {
    pub signed_in: bool,
    pub display_name: Option<String>,
    /// A Epic Games Launcher está instalada neste PC (existe a pasta dos manifestos ou o programa).
    pub launcher_installed: bool,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EpicGame {
    pub app_name: String,
    pub namespace: String,
    pub catalog_item_id: String,
    pub title: String,
    pub developer: String,
    pub description: String,
    /// Capa vertical (a da caixa do jogo) e panorâmica.
    pub image_tall: Option<String>,
    pub image_wide: Option<String>,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EpicInstalled {
    pub app_name: String,
    pub namespace: String,
    pub catalog_item_id: String,
    pub title: String,
    pub install_location: String,
    pub launch_executable: String,
    pub size_bytes: u64,
    /// A instalação não terminou (baixando ou pausada).
    pub incomplete: bool,
    /// Quem instalou: "egl" (Epic Games Launcher) ou "legendary" (instalado pelo launcher, sem a Epic Games Launcher).
    pub managed_by: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredSession {
    account_id: String,
    display_name: String,
    refresh_token: String,
}

// ───────── HTTP (curl.exe, com o pedido pela entrada do processo: tokens não aparecem na linha de comando) ─────────

/// Texto entre aspas de um arquivo de configuração do curl.
fn config_quote(text: &str) -> String {
    let mut out = String::with_capacity(text.len() + 2);
    out.push('"');
    for c in text.chars() {
        match c {
            '\\' => out.push_str("\\\\"),
            '"' => out.push_str("\\\""),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            other => out.push(other),
        }
    }
    out.push('"');
    out
}

pub(crate) fn request(method: &str, url: &str, headers: &[String], body: Option<&str>) -> Result<String, String> {
    request_with_timeout(method, url, headers, body, "40")
}

fn request_with_timeout(method: &str, url: &str, headers: &[String], body: Option<&str>, timeout_secs: &str) -> Result<String, String> {
    let mut config = format!("url = {}\nrequest = {}\nheader = {}\n", config_quote(url), config_quote(method), config_quote(&format!("User-Agent: {USER_AGENT}")));
    for header in headers {
        config.push_str(&format!("header = {}\n", config_quote(header)));
    }
    if let Some(body) = body {
        config.push_str(&format!("data = {}\n", config_quote(body)));
    }
    let mut child = Command::new("curl.exe")
        .args(["-sS", "-m", timeout_secs, "-K", "-"])
        .creation_flags(CREATE_NO_WINDOW)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Não consegui executar o curl: {e}"))?;
    child.stdin.take().ok_or("Sem entrada para o curl.")?.write_all(config.as_bytes()).map_err(|e| e.to_string())?;
    let out = child.wait_with_output().map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(format!("Falha de rede: {}", String::from_utf8_lossy(&out.stderr).trim()));
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

fn json_of(text: &str) -> Result<serde_json::Value, String> {
    serde_json::from_str(text).map_err(|_| "A Epic não respondeu como esperado. Tente de novo.".to_string())
}

/// Erro devolvido pela Epic (`errorCode` / `errorMessage`), já em português para os casos comuns.
fn epic_error(value: &serde_json::Value) -> Option<String> {
    let code = value.get("errorCode").and_then(|v| v.as_str())?;
    let message = value.get("errorMessage").and_then(|v| v.as_str()).unwrap_or("");
    Some(match code {
        c if c.ends_with("authorization_code_not_found") || c.ends_with("invalid_grant") || c.contains("oauth.invalid") => {
            "A Epic não aceitou o código (ele vale poucos minutos e só uma vez). Entre de novo e copie um código novo.".to_string()
        }
        c if c.contains("invalid_refresh_token") || c.contains("token_expired") => "A sessão da Epic expirou. Entre de novo.".to_string(),
        _ => format!("A Epic recusou o pedido: {message}"),
    })
}

fn base64(data: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(data.len().div_ceil(3) * 4);
    for chunk in data.chunks(3) {
        let n = (u32::from(chunk[0]) << 16) | (u32::from(*chunk.get(1).unwrap_or(&0)) << 8) | u32::from(*chunk.get(2).unwrap_or(&0));
        out.push(TABLE[(n >> 18) as usize & 63] as char);
        out.push(TABLE[(n >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 { TABLE[(n >> 6) as usize & 63] as char } else { '=' });
        out.push(if chunk.len() > 2 { TABLE[n as usize & 63] as char } else { '=' });
    }
    out
}

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

// ───────── Login ─────────

/// Página de login da Epic. Depois de entrar, o site mostra um texto com `authorizationCode`: é ele que o jogador devolve.
pub fn login_url() -> String {
    let redirect = format!("https://www.epicgames.com/id/api/redirect?clientId={CLIENT_ID}&responseType=code");
    format!("https://www.epicgames.com/id/login?redirectUrl={}", form_encode(&redirect))
}

/// Aceita o código puro, entre aspas ou o texto inteiro que o site mostra (`{"authorizationCode":"..."}`).
pub fn clean_code(input: &str) -> Option<String> {
    let text = input.trim();
    let code = if text.starts_with('{') {
        let value: serde_json::Value = serde_json::from_str(text).ok()?;
        value.get("authorizationCode").and_then(|v| v.as_str())?.to_string()
    } else {
        text.trim_matches(|c: char| c == '"' || c == '\'' || c.is_whitespace()).to_string()
    };
    (code.len() >= 20 && code.len() <= 64 && code.chars().all(|c| c.is_ascii_alphanumeric())).then_some(code)
}

fn basic_auth() -> String {
    format!("Authorization: Basic {}", base64(format!("{CLIENT_ID}:{CLIENT_SECRET}").as_bytes()))
}

fn token_request(body: &str) -> Result<serde_json::Value, String> {
    let text = request("POST", TOKEN_URL, &[basic_auth(), "Content-Type: application/x-www-form-urlencoded".to_string()], Some(body))?;
    let value = json_of(&text)?;
    if let Some(error) = epic_error(&value) {
        return Err(error);
    }
    Ok(value)
}

/// Último token de acesso (vale por umas 8 horas): evita renovar a cada pedido.
static ACCESS: Mutex<Option<(String, Instant)>> = Mutex::new(None);

fn remember_access(value: &serde_json::Value) -> Option<String> {
    let token = value.get("access_token")?.as_str()?.to_string();
    let seconds = value.get("expires_in").and_then(|v| v.as_u64()).unwrap_or(3600).saturating_sub(120);
    *ACCESS.lock().unwrap() = Some((token.clone(), Instant::now() + Duration::from_secs(seconds)));
    Some(token)
}

/// Troca o código por uma sessão e a guarda (cifrada).
pub fn sign_in(dir: &Path, code: &str) -> Result<EpicStatus, String> {
    let code = clean_code(code).ok_or("Esse não parece o código da Epic. Ele tem letras e números e fica depois de authorizationCode.")?;
    let value = token_request(&format!("grant_type=authorization_code&code={}&token_type=eg1", form_encode(&code)))?;
    let refresh = value.get("refresh_token").and_then(|v| v.as_str()).ok_or("A Epic não devolveu a sessão.")?.to_string();
    let session = StoredSession {
        account_id: value.get("account_id").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
        display_name: value.get("displayName").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
        refresh_token: refresh,
    };
    remember_access(&value);
    save_session(dir, &session)?;
    Ok(status(dir))
}

/// Token de acesso válido da sessão guardada (para outros módulos).
pub(crate) fn access_token_for(dir: &Path) -> Result<String, String> {
    access_token(dir)
}

/// Pasta de configuração do launcher (onde ficam a sessão e o Legendary): definida ao abrir o app.
static CONFIG_DIR: std::sync::OnceLock<PathBuf> = std::sync::OnceLock::new();

pub fn init(config_dir: PathBuf) {
    let _ = CONFIG_DIR.set(config_dir);
}

pub(crate) fn config_dir() -> Option<&'static Path> {
    CONFIG_DIR.get().map(PathBuf::as_path)
}

/// Renova o token de acesso (e o de renovação, que a Epic troca a cada uso).
fn access_token(dir: &Path) -> Result<String, String> {
    if let Some((token, until)) = ACCESS.lock().unwrap().clone() {
        if Instant::now() < until {
            return Ok(token);
        }
    }
    let mut session = load_session(dir).ok_or("Entre na sua conta da Epic primeiro.")?;
    let value = token_request(&format!("grant_type=refresh_token&refresh_token={}&token_type=eg1", form_encode(&session.refresh_token)))?;
    if let Some(next) = value.get("refresh_token").and_then(|v| v.as_str()) {
        session.refresh_token = next.to_string();
        if let Some(name) = value.get("displayName").and_then(|v| v.as_str()) {
            session.display_name = name.to_string();
        }
        save_session(dir, &session)?;
    }
    remember_access(&value).ok_or_else(|| "A Epic não devolveu o acesso.".to_string())
}

pub fn status(dir: &Path) -> EpicStatus {
    let session = load_session(dir);
    let launcher_installed = manifests_dir().is_dir() || preview_data_dir().is_some_and(|dir| dir.is_dir());
    EpicStatus { signed_in: session.is_some(), display_name: session.map(|s| s.display_name).filter(|n| !n.is_empty()), launcher_installed }
}

pub fn sign_out(dir: &Path) -> Result<(), String> {
    *ACCESS.lock().unwrap() = None;
    crate::epic_install::sign_out(dir);
    match std::fs::remove_file(dir.join(SESSION_FILE)) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

// ───────── Biblioteca da conta ─────────

/// Primeira imagem de um dos tipos, na ordem de preferência.
fn key_image(item: &serde_json::Value, kinds: &[&str]) -> Option<String> {
    let images = item.get("keyImages")?.as_array()?;
    kinds.iter().find_map(|kind| {
        images.iter().find(|image| image.get("type").and_then(|v| v.as_str()) == Some(kind)).and_then(|image| image.get("url")).and_then(|v| v.as_str()).map(str::to_string)
    })
}

/// É um jogo de verdade (e não um DLC, ferramenta ou extra)?
fn is_game(item: &serde_json::Value) -> bool {
    let paths: Vec<&str> = item.get("categories").and_then(|v| v.as_array()).map(|list| list.iter().filter_map(|c| c.get("path").and_then(|p| p.as_str())).collect()).unwrap_or_default();
    let has_game = paths.iter().any(|p| *p == "games" || p.starts_with("games/"));
    let is_addon = paths.iter().any(|p| *p == "addons" || p.starts_with("addons/") || *p == "digitalextras");
    let has_main = item.get("mainGameItem").is_some_and(|v| !v.is_null());
    has_game && !is_addon && !has_main
}

/// Os itens do catálogo, qualquer que seja o aninhamento da resposta (namespace → id → item).
fn collect_items<'a>(value: &'a serde_json::Value, out: &mut Vec<&'a serde_json::Value>) {
    if let Some(map) = value.as_object() {
        if map.contains_key("title") && map.contains_key("id") {
            out.push(value);
        } else {
            for child in map.values() {
                collect_items(child, out);
            }
        }
    }
}

pub fn fetch_library(dir: &Path) -> Result<Vec<EpicGame>, String> {
    let token = access_token(dir)?;
    let bearer = format!("Authorization: Bearer {token}");

    // Os registros da biblioteca, página por página.
    let mut records: Vec<(String, String, String)> = Vec::new();
    let mut cursor: Option<String> = None;
    for _ in 0..60 {
        let mut url = format!("{LIBRARY_URL}?includeMetadata=true");
        if let Some(c) = &cursor {
            url.push_str(&format!("&cursor={}", form_encode(c)));
        }
        let value = json_of(&request("GET", &url, std::slice::from_ref(&bearer), None)?)?;
        if let Some(error) = epic_error(&value) {
            // O token pode ter sido revogado: esquece o de acesso para o próximo pedido renovar.
            *ACCESS.lock().unwrap() = None;
            return Err(error);
        }
        for record in value.get("records").and_then(|v| v.as_array()).into_iter().flatten() {
            let text = |key: &str| record.get(key).and_then(|v| v.as_str()).unwrap_or_default().to_string();
            let (app, id, ns) = (text("appName"), text("catalogItemId"), text("namespace"));
            // "ue" é o mercado de conteúdo da Unreal Engine, não são jogos.
            if app.is_empty() || id.is_empty() || ns.is_empty() || ns == "ue" {
                continue;
            }
            if !records.iter().any(|(_, existing, _)| *existing == id) {
                records.push((app, id, ns));
            }
        }
        cursor = value.get("responseMetadata").and_then(|m| m.get("nextCursor")).and_then(|v| v.as_str()).map(str::to_string);
        if cursor.is_none() {
            break;
        }
    }

    // Os detalhes (nome, capa, categorias) vêm do catálogo. O que já foi consultado fica guardado em disco (inclusive o que
    // não é jogo), então depois da primeira vez só os itens novos são consultados.
    let mut cache = load_catalog(dir);
    let missing: Vec<&(String, String, String)> = records.iter().filter(|(_, id, _)| !cache.contains_key(id)).collect();
    if !missing.is_empty() {
        let mut groups: std::collections::BTreeMap<&str, Vec<&str>> = std::collections::BTreeMap::new();
        for (_, id, ns) in &missing {
            groups.entry(ns.as_str()).or_default().push(id.as_str());
        }
        let queue: Mutex<Vec<(&str, Vec<&str>)>> = Mutex::new(groups.into_iter().collect());
        let found: Mutex<Vec<(String, Option<EpicGame>)>> = Mutex::new(Vec::new());
        let failures = std::sync::atomic::AtomicUsize::new(0);
        let last_error: Mutex<Option<String>> = Mutex::new(None);
        std::thread::scope(|scope| {
            // Várias consultas ao mesmo tempo: são centenas de namespaces, um por jogo.
            for _ in 0..8 {
                scope.spawn(|| loop {
                    let Some((namespace, ids)) = queue.lock().unwrap().pop() else { break };
                    match fetch_catalog_group(&bearer, namespace, &ids, &records) {
                        Ok(items) => found.lock().unwrap().extend(items),
                        Err(error) => {
                            failures.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                            *last_error.lock().unwrap() = Some(error);
                        }
                    }
                });
            }
        });
        for (id, game) in found.into_inner().unwrap() {
            cache.insert(id, game);
        }
        save_catalog(dir, &cache);
        // Se nada do catálogo veio, a lista da conta não tem como ser montada.
        if failures.load(std::sync::atomic::Ordering::Relaxed) > 0 && cache.is_empty() {
            return Err(last_error.into_inner().unwrap().unwrap_or_else(|| "A Epic não respondeu.".to_string()));
        }
    }
    let mut games: Vec<EpicGame> = records.iter().filter_map(|(_, id, _)| cache.get(id).cloned().flatten()).collect();
    games.sort_by(|a, b| a.title.to_lowercase().cmp(&b.title.to_lowercase()));
    Ok(games)
}

/// Consulta o catálogo de um namespace (uma ou mais peças de uma vez). Devolve (id, jogo) de cada id pedido: `None` quando
/// o item existe mas não é um jogo (DLC, ferramenta...), para não ser consultado de novo.
fn fetch_catalog_group(bearer: &str, namespace: &str, ids: &[&str], records: &[(String, String, String)]) -> Result<Vec<(String, Option<EpicGame>)>, String> {
    let mut url = format!("{CATALOG_URL}/{}/bulk/items?", form_encode(namespace));
    for id in ids {
        url.push_str(&format!("id={}&", form_encode(id)));
    }
    url.push_str("includeDLCDetails=true&includeMainGameDetails=true&country=BR&locale=pt-BR");
    let value = json_of(&request("GET", &url, &[bearer.to_string()], None)?)?;
    if let Some(error) = epic_error(&value) {
        return Err(error);
    }
    let mut items = Vec::new();
    collect_items(&value, &mut items);
    let mut out = Vec::new();
    for id in ids {
        let item = items.iter().find(|item| item.get("id").and_then(|v| v.as_str()) == Some(*id));
        let Some(item) = item else {
            // A Epic não devolveu o item (já não existe, ou é de outro tipo): não é um jogo que se possa mostrar.
            out.push((id.to_string(), None));
            continue;
        };
        if !is_game(item) {
            out.push((id.to_string(), None));
            continue;
        }
        let Some((app, _, ns)) = records.iter().find(|(_, record_id, _)| record_id == id) else { continue };
        let text = |key: &str| item.get(key).and_then(|v| v.as_str()).unwrap_or_default().to_string();
        let tall = key_image(item, &["DieselGameBoxTall", "OfferImageTall", "Thumbnail"]);
        let wide = key_image(item, &["DieselGameBox", "OfferImageWide", "DieselStoreFrontWide"]).or_else(|| tall.clone());
        out.push((
            id.to_string(),
            Some(EpicGame {
                app_name: app.clone(),
                namespace: ns.clone(),
                catalog_item_id: id.to_string(),
                title: text("title"),
                developer: text("developer"),
                description: text("description"),
                image_tall: tall,
                image_wide: wide,
            }),
        ));
    }
    Ok(out)
}

const CATALOG_FILE: &str = "epic_catalog.json";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogGame {
    namespace: String,
    catalog_item_id: String,
    title: String,
}

#[derive(Deserialize)]
struct StoreOffers {
    elements: Vec<StoreOffer>,
    paging: OfferPaging,
}

#[derive(Deserialize)]
struct StoreOffer {
    title: String,
    #[serde(default)]
    tags: Vec<u64>,
    items: Vec<OfferItem>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct OfferItem {
    id: String,
    namespace: String,
    #[serde(default)]
    ns_major_items: Vec<String>,
}

#[derive(Deserialize)]
struct OfferPaging {
    total: usize,
}

impl CatalogGame {
    fn cache_key(&self) -> String {
        format!("{}:{}", self.namespace, self.catalog_item_id)
    }

    fn matches(&self, offer: &StoreOffer) -> bool {
        // Ofertas antigas podem incluir só um item de audiência. Nesse caso, o título exato da oferta
        // dentro do mesmo namespace ainda identifica o jogo, sem usar resultados de outra loja.
        let title = self.title.trim().to_lowercase();
        (!title.is_empty() && title == offer.title.trim().to_lowercase())
            || offer.items.iter().any(|item| {
                (item.namespace == self.namespace && item.id == self.catalog_item_id)
                    || item.ns_major_items.contains(&self.cache_key())
            })
    }
}

/// Um token de catálogo sem conta também cobre jogos encontrados apenas nos manifestos locais.
fn catalog_header() -> Result<String, String> {
    static ACCESS: Mutex<Option<(String, Instant)>> = Mutex::new(None);
    let mut access = ACCESS.lock().unwrap();
    if let Some((header, until)) = access.as_ref() {
        if Instant::now() < *until {
            return Ok(header.clone());
        }
    }
    let value = token_request("grant_type=client_credentials&token_type=eg1")?;
    let token = value.get("access_token").and_then(|v| v.as_str()).ok_or("A Epic não devolveu o acesso.")?;
    let header = format!("Authorization: Bearer {token}");
    let seconds = value.get("expires_in").and_then(|v| v.as_u64()).unwrap_or(3600).saturating_sub(120);
    *access = Some((header.clone(), Instant::now() + Duration::from_secs(seconds)));
    Ok(header)
}

fn store_offers(namespace: &str, header: &str) -> Option<Vec<StoreOffer>> {
    const PAGE: usize = 100;
    let mut offers = Vec::new();
    for start in (0..500).step_by(PAGE) {
        let url = format!("{CATALOG_URL}/{namespace}/offers?category=games%2Fedition%2Fbase&country=BR&locale=pt-BR&count={PAGE}&start={start}");
        let text = request_with_timeout("GET", &url, &[header.to_string()], None, "12").ok()?;
        let page: StoreOffers = serde_json::from_str(&text).ok()?;
        let received = page.elements.len();
        offers.extend(page.elements);
        if start + received >= page.paging.total {
            return Some(offers);
        }
        if received != PAGE {
            return None;
        }
    }
    None
}

/// Ausência de etiqueta fica como não confirmada. Falhas ficam fora da resposta para poder tentar depois.
pub fn controller_support(games: Vec<CatalogGame>) -> Result<HashMap<String, bool>, String> {
    let mut groups: HashMap<&str, Vec<&CatalogGame>> = HashMap::new();
    for game in &games {
        if safe_id(&game.namespace) && safe_id(&game.catalog_item_id) {
            groups.entry(&game.namespace).or_default().push(game);
        }
    }
    if groups.is_empty() {
        return Ok(HashMap::new());
    }
    let header = catalog_header()?;
    let queue = Mutex::new(groups.into_iter());
    let results = Mutex::new(HashMap::new());
    std::thread::scope(|scope| {
        for _ in 0..6 {
            scope.spawn(|| loop {
                let Some((namespace, games)) = queue.lock().unwrap().next() else { break };
                let Some(offers) = store_offers(namespace, &header) else { continue };
                let mut results = results.lock().unwrap();
                for game in games {
                    let supported = offers.iter().any(|offer| offer.tags.contains(&CONTROLLER_TAG) && game.matches(offer));
                    results.insert(game.cache_key(), supported);
                }
            });
        }
    });
    Ok(results.into_inner().unwrap())
}

/// Catálogo já consultado: id do item → o jogo (ou `None` se não é jogo). Só títulos e capas públicas, nada da conta.
type CatalogCache = std::collections::HashMap<String, Option<EpicGame>>;

fn load_catalog(dir: &Path) -> CatalogCache {
    std::fs::read(dir.join(CATALOG_FILE)).ok().and_then(|raw| serde_json::from_slice(&raw).ok()).unwrap_or_default()
}

fn save_catalog(dir: &Path, cache: &CatalogCache) {
    if let Ok(json) = serde_json::to_vec(cache) {
        let _ = std::fs::create_dir_all(dir);
        let _ = std::fs::write(dir.join(CATALOG_FILE), json);
    }
}

// ───────── Jogos instalados (arquivos da Epic Games Launcher) ─────────

fn manifests_dir() -> PathBuf {
    let base = std::env::var_os("ProgramData").map(PathBuf::from).unwrap_or_else(|| PathBuf::from(r"C:\ProgramData"));
    base.join("Epic").join("EpicGamesLauncher").join("Data").join("Manifests")
}

/// Lê um manifesto (`.item`). DLCs, jogos sem pasta e o que não é aplicativo ficam de fora.
pub fn parse_manifest(text: &str) -> Option<EpicInstalled> {
    let value: serde_json::Value = serde_json::from_str(text).ok()?;
    let str_of = |key: &str| value.get(key).and_then(|v| v.as_str()).unwrap_or_default().to_string();
    let app_name = str_of("AppName");
    let main = str_of("MainGameAppName");
    if app_name.is_empty() || (!main.is_empty() && main != app_name) {
        return None;
    }
    let install_location = str_of("InstallLocation");
    let launch_executable = str_of("LaunchExecutable");
    if install_location.is_empty() || launch_executable.is_empty() {
        return None;
    }
    let title = Some(str_of("DisplayName")).filter(|t| !t.is_empty()).unwrap_or_else(|| app_name.clone());
    Some(EpicInstalled {
        app_name,
        namespace: str_of("CatalogNamespace"),
        catalog_item_id: str_of("CatalogItemId"),
        title,
        install_location,
        launch_executable,
        size_bytes: value.get("InstallSize").and_then(|v| v.as_u64()).unwrap_or(0),
        incomplete: value.get("bIsIncompleteInstall").and_then(|v| v.as_bool()).unwrap_or(false),
        managed_by: "egl".to_string(),
    })
}

fn read_installed(dir: &Path) -> Vec<EpicInstalled> {
    let Ok(entries) = std::fs::read_dir(dir) else { return Vec::new() };
    let mut games: Vec<EpicInstalled> = entries
        .flatten()
        .filter(|e| e.path().extension().is_some_and(|ext| ext.eq_ignore_ascii_case("item")))
        .filter_map(|e| std::fs::read_to_string(e.path()).ok())
        // Alguns manifestos começam com a marca de ordem de bytes do UTF-8.
        .filter_map(|text| parse_manifest(text.trim_start_matches('\u{feff}')))
        .collect();
    games.sort_by(|a, b| a.title.to_lowercase().cmp(&b.title.to_lowercase()));
    games.dedup_by(|a, b| a.app_name == b.app_name);
    games
}

pub(crate) fn preview_data_dir() -> Option<PathBuf> {
    RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey(r"Software\Epic Games\EpicGamesLauncher")
        .and_then(|key| key.get_value::<String, _>("AppDataPath"))
        .ok()
        .filter(|path| !path.is_empty())
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("LOCALAPPDATA").map(|base| PathBuf::from(base).join("com.epicgames.eglv2")))
}

/// O cliente novo registra cada mudança da instalação em uma linha, na ordem em que ocorreu.
fn parse_preview_installations(text: &str) -> impl Iterator<Item = EpicInstalled> + '_ {
    let mut seen = HashSet::new();
    text.trim_start_matches('\u{feff}').lines().rev().filter_map(move |line| {
        let value: serde_json::Value = serde_json::from_str(line).ok()?;
        let field = |key| value.get(key).and_then(|v| v.as_str()).filter(|s| !s.is_empty());
        if !seen.insert(field("installationId")?.to_string()) {
            return None;
        }
        let app_name = field("artifactId")?;
        let namespace = field("namespace")?;
        let catalog_item_id = field("itemId")?;
        if ![app_name, namespace, catalog_item_id].into_iter().all(safe_id) {
            return None;
        }
        let install_location = field("dir")?;
        let launch_executable = field("launchExecutable")?;
        let incomplete = !value.get("complete")?.as_bool()?;
        let title = Path::new(install_location).file_name().and_then(|name| name.to_str()).unwrap_or(app_name);
        Some(EpicInstalled {
            title: title.to_string(),
            app_name: app_name.to_string(),
            namespace: namespace.to_string(),
            catalog_item_id: catalog_item_id.to_string(),
            install_location: install_location.to_string(),
            launch_executable: launch_executable.to_string(),
            size_bytes: 0,
            incomplete,
            managed_by: "egl".to_string(),
        })
    })
}

static INSTALLED: Mutex<Option<(Instant, Vec<EpicInstalled>)>> = Mutex::new(None);

pub(crate) fn invalidate_installed() {
    *INSTALLED.lock().unwrap() = None;
}

/// Jogos instalados pela Epic (relido no máximo a cada 2 s).
pub fn installed() -> Vec<EpicInstalled> {
    let mut cache = INSTALLED.lock().unwrap();
    if let Some((at, list)) = cache.as_ref() {
        if at.elapsed() < Duration::from_secs(2) {
            return list.clone();
        }
    }
    let preview = preview_data_dir()
        .and_then(|dir| std::fs::read_to_string(dir.join("installations.jsonl")).ok())
        .unwrap_or_default();
    let preview = parse_preview_installations(&preview).filter(|game| Path::new(&game.install_location).is_dir());
    let legacy = read_installed(&manifests_dir());
    let legendary = config_dir().map(crate::epic_install::installed).unwrap_or_default();
    let mut by_name = HashMap::<String, EpicInstalled>::new();
    // Prefere uma cópia pronta para jogar. Entre cópias equivalentes, prefere o cliente oficial mais recente.
    for game in preview.chain(legacy).chain(legendary) {
        let key = game.app_name.clone();
        if by_name.get(&key).is_none_or(|existing| existing.incomplete && !game.incomplete) {
            by_name.insert(key, game);
        }
    }
    let mut list: Vec<_> = by_name.into_values().collect();
    list.sort_by(|a, b| a.title.to_lowercase().cmp(&b.title.to_lowercase()).then_with(|| a.app_name.cmp(&b.app_name)));
    *cache = Some((Instant::now(), list.clone()));
    list
}

// ───────── Abrir, instalar, jogo em execução ─────────

pub(crate) fn safe_name(text: &str) -> bool {
    safe_id(text)
}

/// Só letras, números e os separadores que os identificadores da Epic usam: nada de montar URIs arbitrários.
fn safe_id(text: &str) -> bool {
    !text.is_empty() && text.len() <= 100 && text.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.')
}

fn app_uri(namespace: &str, catalog_item_id: &str, app_name: &str, action: &str) -> Result<String, String> {
    if ![namespace, catalog_item_id, app_name].iter().all(|part| safe_id(part)) {
        return Err("Identificador de jogo inválido.".into());
    }
    Ok(format!("com.epicgames.launcher://apps/{namespace}%3A{catalog_item_id}%3A{app_name}?action={action}"))
}

use crate::shell::open_uri;

/// Abre o jogo pela Epic Games Launcher (que sobe em segundo plano se ainda não estiver aberta).
pub fn launch(app_name: &str) -> Result<(), String> {
    let game = installed().into_iter().find(|g| g.app_name == app_name).ok_or("Esse jogo não está instalado pela Epic.")?;
    if game.incomplete {
        return Err("A instalação desse jogo ainda não terminou.".into());
    }
    if game.managed_by == "legendary" {
        let dir = config_dir().ok_or("O launcher ainda está iniciando.")?;
        return crate::epic_install::launch(dir, &game.app_name);
    }
    open_uri(&app_uri(&game.namespace, &game.catalog_item_id, &game.app_name, "launch&silent=true")?)
}

/// Pede a instalação: a Epic Games Launcher abre na página do jogo, onde o jogador escolhe a pasta e confirma.
pub fn install(namespace: &str, catalog_item_id: &str, app_name: &str) -> Result<(), String> {
    // `silent=true` é o parâmetro que a Epic documenta para "launch" (não mostrar a janela dela); aqui se tenta o mesmo no
    // "install". Se a Epic Games Launcher o ignorar, ela mostra a janela de instalação normal.
    open_uri(&app_uri(namespace, catalog_item_id, app_name, "install&silent=true")?)
}

/// Abre a Epic Games Launcher na biblioteca (para desinstalar, atualizar e gerenciar).
pub fn open_library() -> Result<(), String> {
    open_uri("com.epicgames.launcher://store/library")
}

/// Abre o endereço no navegador padrão (a página de login da Epic).
pub fn open_login() -> Result<(), String> {
    open_uri(&login_url())
}

// ───────── Login numa janela do próprio launcher ─────────
//
// Como o Playnite: a página de login da Epic abre numa janela (sem cookies guardados), o jogador entra nela e, quando a Epic
// mostra o texto com o `authorizationCode`, o launcher lê o código sozinho (a página é desviada para um endereço
// que só o launcher entende, e ele o intercepta), troca-o pela sessão e fecha a janela. Nada passa pelo launcher além do código.

const LOGIN_LABEL: &str = "epic-login";
/// Endereço "de mentira" para onde a página de código é desviada: o launcher o intercepta e a janela nunca o carrega.
const CODE_HOST: &str = "epic-code.launcher.invalid";
static LOGIN_HWND: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
static LOGIN_DONE: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// Resultado do login numa janela, entregue à interface pelo evento `epic-login`.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LoginEvent {
    /// "done", "cancelled" ou "error".
    pub state: &'static str,
    pub status: Option<EpicStatus>,
    pub error: Option<String>,
}

/// A janela de login está na frente (o controle vira mouse nela, como nas janelas da Steam).
pub fn login_in_front() -> bool {
    use windows_sys::Win32::UI::WindowsAndMessaging::GetForegroundWindow;
    let hwnd = LOGIN_HWND.load(std::sync::atomic::Ordering::Relaxed);
    // SAFETY: só pergunta ao Windows qual é a janela da frente.
    hwnd != 0 && unsafe { GetForegroundWindow() } as usize == hwnd
}

/// Fecha a janela de login, se estiver aberta.
pub fn close_login(app: &tauri::AppHandle) {
    use tauri::Manager;
    if let Some(window) = app.get_webview_window(LOGIN_LABEL) {
        let _ = window.close();
    }
}

/// Código que a página de login entregou ao endereço de mentira (`?code=...`).
fn captured_code(url: &tauri::Url) -> Option<String> {
    if url.host_str() != Some(CODE_HOST) {
        return None;
    }
    url.query_pairs().find(|(key, _)| key == "code").map(|(_, value)| value.into_owned())
}

pub fn open_login_window(app: tauri::AppHandle) -> Result<(), String> {
    use std::sync::atomic::Ordering;
    use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

    close_login(&app);
    LOGIN_DONE.store(false, Ordering::Relaxed);
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    // Pasta própria para o navegador embutido do login (o WebView2 não deixa duas janelas com configurações diferentes
    // dividirem a mesma pasta, e assim o login também não toca nos dados do launcher). Começa vazia e é apagada ao fechar.
    let web_dir = app.path().app_local_data_dir().map_err(|e| e.to_string())?.join("epic-login-webview");
    let _ = std::fs::remove_dir_all(&web_dir);
    let _ = std::fs::create_dir_all(&web_dir);
    let url: tauri::Url = login_url().parse().map_err(|_| "Endereço de login inválido.".to_string())?;

    let navigation_app = app.clone();
    let destroyed_app = app.clone();
    let main = app.get_webview_window("main").ok_or("Janela principal ausente.")?;
    // Janela "filha" do launcher: o Windows a mantém sempre por cima dele, mesmo com o launcher em primeiro plano.
    let window = WebviewWindowBuilder::new(&app, LOGIN_LABEL, WebviewUrl::External(url))
        .owner(&main)
        .map_err(|e| e.to_string())?
        .title("Entrar na Epic Games")
        .inner_size(1100.0, 820.0)
        .center()
        .data_directory(web_dir.clone())
        .on_navigation(move |target| {
            let Some(code) = captured_code(target) else { return true };
            if !LOGIN_DONE.swap(true, Ordering::Relaxed) {
                let app = navigation_app.clone();
                let dir = dir.clone();
                std::thread::spawn(move || {
                    let event = match sign_in(&dir, &code) {
                        Ok(status) => LoginEvent { state: "done", status: Some(status), error: None },
                        Err(error) => LoginEvent { state: "error", status: None, error: Some(error) },
                    };
                    let _ = app.emit("epic-login", event);
                    close_login(&app);
                });
            }
            false
        })
        .on_page_load(|window, payload| {
            // A página que mostra o código: lê o texto e entrega o código ao endereço de mentira.
            if payload.event() == tauri::webview::PageLoadEvent::Finished && payload.url().path() == "/id/api/redirect" {
                let _ = window.eval(&format!(
                    "(function(){{try{{var j=JSON.parse(document.body.innerText);if(j.authorizationCode){{location.href='https://{CODE_HOST}/?code='+encodeURIComponent(j.authorizationCode);}}}}catch(e){{}}}})();"
                ));
            }
        })
        .build()
        .map_err(|e| e.to_string())?;

    if let Ok(hwnd) = window.hwnd() {
        LOGIN_HWND.store(hwnd.0 as usize, Ordering::Relaxed);
        crate::guide::force_foreground(hwnd.0 as usize as windows_sys::Win32::Foundation::HWND);
    }
    window.on_window_event(move |event| {
        if matches!(event, tauri::WindowEvent::Destroyed) {
            LOGIN_HWND.store(0, Ordering::Relaxed);
            crate::pointer::set_active(false);
            if !LOGIN_DONE.swap(true, Ordering::Relaxed) {
                let _ = destroyed_app.emit("epic-login", LoginEvent { state: "cancelled", status: None, error: None });
            }
            crate::guide::ensure_launcher_front(&destroyed_app, 3);
            // Apaga o que o login deixou (cookies, cache): o WebView2 ainda leva um instante para soltar os arquivos.
            let web_dir = web_dir.clone();
            std::thread::spawn(move || {
                for _ in 0..5 {
                    std::thread::sleep(Duration::from_secs(3));
                    if std::fs::remove_dir_all(&web_dir).is_ok() {
                        break;
                    }
                }
            });
        }
    });
    // O controle vira mouse enquanto a janela estiver na frente (Start volta ao launcher).
    crate::pointer::set_active(true);
    let _ = window.set_focus();
    Ok(())
}

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EpicRunning {
    pub app_name: String,
    pub title: String,
}

fn match_installation<'a>(image: &Path, games: &'a [EpicInstalled]) -> Option<&'a EpicInstalled> {
    games.iter().filter(|game| !game.incomplete && !game.install_location.is_empty())
        .filter_map(|game| {
            let dir = crate::steam::windows_path(&game.install_location);
            image.starts_with(&dir).then_some((dir.components().count(), game))
        })
        .max_by_key(|(depth, _)| *depth)
        .map(|(_, game)| game)
}

fn game_for_pid(pid: u32, games: &[EpicInstalled]) -> Option<EpicRunning> {
    let image = crate::steam::windows_path(&crate::hide::process_image(pid)?);
    let game = match_installation(&image, games)?;
    Some(EpicRunning { app_name: game.app_name.clone(), title: game.title.clone() })
}

pub(crate) fn game_for_process(pid: u32) -> Option<EpicRunning> {
    let games = installed();
    if games.is_empty() {
        return None;
    }
    game_for_pid(pid, &games)
}

/// Confirma o jogo pela janela. Um instalador ou processo auxiliar sem janela não conta como jogo aberto.
fn running_game(app_name: Option<&str>) -> Option<(EpicRunning, crate::guide::GameWindow)> {
    use crate::guide::GameWindow;
    use windows_sys::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, IsWindowVisible};

    let games = installed();
    if games.is_empty() {
        return None;
    }
    let game_for_window = |pid| game_for_pid(pid, &games).filter(|game| app_name.is_none_or(|name| game.app_name == name));
    // SAFETY: só consulta a janela ativa e seu estado.
    let foreground = unsafe { GetForegroundWindow() };
    if unsafe { IsWindowVisible(foreground) } != 0 {
        if let Some(window) = GameWindow::from_hwnd(foreground) {
            if let Some(game) = game_for_window(window.pid) {
                return Some((game, window));
            }
        }
    }
    crate::guide::find_game_window_by(game_for_window).map(|(window, game)| (game, window))
}

static RUNNING: Mutex<Option<(Instant, Option<EpicRunning>)>> = Mutex::new(None);

/// O jogo da Epic em execução (consultado no máximo a cada 1,5 s).
pub fn running() -> Option<EpicRunning> {
    let mut cache = RUNNING.lock().unwrap();
    if let Some((at, value)) = cache.as_ref() {
        if at.elapsed() < Duration::from_millis(1500) {
            return value.clone();
        }
    }
    let value = running_game(None).map(|(game, _)| game);
    *cache = Some((Instant::now(), value.clone()));
    value
}

/// A maior janela normal do jogo da Epic em execução.
pub(crate) fn running_window(app_name: Option<&str>) -> Option<crate::guide::GameWindow> {
    running_game(app_name).map(|(_, window)| window)
}

/// Uma janela minimizada ainda conta. O executável registrado também conta durante a abertura,
/// antes de criar a primeira janela.
pub(crate) fn has_game_process() -> bool {
    if running_window(None).is_some() {
        return true;
    }
    let games = installed();
    let executables: HashSet<_> = games.iter().filter(|game| !game.incomplete)
        .filter_map(|game| Path::new(&game.launch_executable).file_name()?.to_str())
        .map(str::to_ascii_lowercase)
        .collect();
    if executables.is_empty() {
        return false;
    }
    crate::hide::find_process(|pid, name| {
        executables.contains(&name.to_ascii_lowercase()) && game_for_pid(pid, &games).is_some()
    }).is_some()
}

pub(crate) fn launch_window(app_name: &str) -> Option<crate::guide::GameWindow> {
    let games = installed();
    crate::launch::find_launch_window(|pid| {
        game_for_pid(pid, &games).filter(|game| game.app_name == app_name).map(|_| ())
    })
}

pub(crate) fn launch_confirmed(pid: u32) {
    if let Some(game) = game_for_process(pid) {
        *RUNNING.lock().unwrap() = Some((Instant::now(), Some(game)));
    }
}

/// Pede ao jogo em execução que feche pelo fluxo normal (a janela recebe WM_CLOSE).
pub fn close_running() -> Result<(), String> {
    close_game(None)
}

pub(crate) fn close_game(app_name: Option<&str>) -> Result<(), String> {
    use windows_sys::Win32::UI::WindowsAndMessaging::{PostMessageW, WM_CLOSE};
    if app_name.is_none() && running().is_none() {
        return Err("Nenhum jogo da Epic está em execução.".into());
    }
    let window = running_window(app_name).and_then(crate::guide::GameWindow::hwnd)
        .ok_or("A janela do jogo não está disponível para fechar.")?;
    // SAFETY: o HWND acabou de ser localizado e pertence a um programa da pasta do jogo.
    if unsafe { PostMessageW(window, WM_CLOSE, 0, 0) } == 0 {
        return Err("Não foi possível pedir o fechamento do jogo.".into());
    }
    Ok(())
}

// ───────── Sessão guardada (cifrada com a conta do Windows) ─────────

fn save_session(dir: &Path, session: &StoredSession) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let json = serde_json::to_vec(session).map_err(|e| e.to_string())?;
    std::fs::write(dir.join(SESSION_FILE), crate::steam_auth::protect(&json)?).map_err(|e| e.to_string())
}

fn load_session(dir: &Path) -> Option<StoredSession> {
    let raw = std::fs::read(dir.join(SESSION_FILE)).ok()?;
    serde_json::from_slice(&crate::steam_auth::unprotect(&raw)?).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identifica_o_jogo_pela_pasta_de_instalacao_mais_especifica() {
        let manifest = r#"{"AppName":"test","InstallLocation":"D:\\Epic","LaunchExecutable":"Game.exe"}"#;
        let mut parent = parse_manifest(manifest).unwrap();
        parent.app_name = "parent".into();
        let mut child = parent.clone();
        child.app_name = "child".into();
        child.install_location = r"D:\Epic\Game".into();
        let games = [parent, child];
        let image = crate::steam::windows_path(r"\\?\D:\EPIC\Game\Binaries\Win64\Game.exe");
        assert_eq!(match_installation(&image, &games).unwrap().app_name, "child");
        let unrelated = crate::steam::windows_path(r"D:\EpicBackup\Game.exe");
        assert!(match_installation(&unrelated, &games).is_none());
    }

    #[test]
    fn base64_do_basic() {
        assert_eq!(base64(b"user:pass"), "dXNlcjpwYXNz");
        assert_eq!(base64(b"ab"), "YWI=");
        assert_eq!(base64(b"a"), "YQ==");
    }

    #[test]
    fn aceita_o_codigo_em_varios_formatos() {
        let code = "0123456789abcdef0123456789abcdef";
        assert_eq!(clean_code(code).as_deref(), Some(code));
        assert_eq!(clean_code(&format!("  \"{code}\"\n")).as_deref(), Some(code));
        assert_eq!(clean_code(&format!(r#"{{"redirectUrl":"x","authorizationCode":"{code}","sid":null}}"#)).as_deref(), Some(code));
        assert_eq!(clean_code("curto"), None);
        assert_eq!(clean_code("codigo com espaco no meio 0123456789"), None);
    }

    #[test]
    fn le_o_codigo_do_endereco_de_mentira() {
        let url: tauri::Url = format!("https://{CODE_HOST}/?code=abc123").parse().unwrap();
        assert_eq!(captured_code(&url).as_deref(), Some("abc123"));
        let other: tauri::Url = "https://www.epicgames.com/id/api/redirect?code=x".parse().unwrap();
        assert_eq!(captured_code(&other), None);
    }

    #[test]
    fn url_de_login_leva_o_cliente_da_epic() {
        let url = login_url();
        assert!(url.starts_with("https://www.epicgames.com/id/login?redirectUrl="));
        assert!(url.contains(CLIENT_ID));
        assert!(!url.contains(' '));
    }

    #[test]
    fn config_do_curl_escapa_aspas_e_barras() {
        assert_eq!(config_quote(r#"a"b\c"#), r#""a\"b\\c""#);
        assert_eq!(config_quote("x\ny"), r#""x\ny""#);
    }

    #[test]
    fn manifesto_de_jogo_instalado() {
        let text = r#"{"FormatVersion":0,"bIsIncompleteInstall":false,"AppName":"Sugar","DisplayName":"Rocket League","InstallLocation":"D:\\Games\\RocketLeague","LaunchExecutable":"Binaries\\Win64\\RocketLeague.exe","CatalogNamespace":"9773aa1aa54f4f7b80e44bef04986cea","CatalogItemId":"530145df28a24424923f5828cc9031a1","InstallSize":123456,"MainGameAppName":"Sugar"}"#;
        let game = parse_manifest(text).unwrap();
        assert_eq!(game.title, "Rocket League");
        assert_eq!(game.install_location, r"D:\Games\RocketLeague");
        assert_eq!(game.size_bytes, 123456);
        assert!(!game.incomplete);
    }

    #[test]
    fn manifesto_de_dlc_e_ignorado() {
        let text = r#"{"AppName":"SugarDLC","DisplayName":"Pacote","InstallLocation":"D:\\x","LaunchExecutable":"a.exe","MainGameAppName":"Sugar"}"#;
        assert!(parse_manifest(text).is_none());
    }

    #[test]
    fn acompanha_instalacoes_do_cliente_novo_pelo_ultimo_registro() {
        let text = r#"
{"version":1,"entries":0}
{"installationId":"1","complete":false,"dir":"D:\\Games\\A","namespace":"n","itemId":"a","artifactId":"game-a","launchExecutable":"A.exe"}
{"installationId":"2","complete":false,"dir":"D:\\Games\\B","namespace":"n","itemId":"b","artifactId":"game-b","launchExecutable":"B.exe"}
{"installationId":"1","complete":true,"dir":"D:\\Games\\A","namespace":"n","itemId":"a","artifactId":"game-a","launchExecutable":"A.exe"}
{"installationId":"3","complete":true,"dir":"D:\\Games\\C","namespace":"n","itemId":"c","artifactId":"game-c","launchExecutable":"C.exe"}
{"installationId":"3"}
{"installationId":"4","complete":true
"#;
        let games: HashMap<_, _> = parse_preview_installations(text).map(|game| (game.app_name.clone(), game)).collect();
        assert_eq!(games.len(), 2);
        assert!(!games["game-a"].incomplete);
        assert_eq!(games["game-a"].title, "A");
        assert_eq!(games["game-a"].catalog_item_id, "a");
        assert_eq!(games["game-a"].launch_executable, "A.exe");
        assert!(games["game-b"].incomplete);
    }

    #[test]
    fn so_jogos_entram_na_biblioteca() {
        let game = serde_json::json!({ "categories": [{ "path": "games" }, { "path": "games/edition/base" }, { "path": "applications" }] });
        let dlc = serde_json::json!({ "categories": [{ "path": "games" }, { "path": "addons/durable" }], "mainGameItem": { "id": "x" } });
        let tool = serde_json::json!({ "categories": [{ "path": "applications" }] });
        assert!(is_game(&game));
        assert!(!is_game(&dlc));
        assert!(!is_game(&tool));
    }

    #[test]
    fn acha_os_itens_do_catalogo_em_qualquer_aninhamento() {
        let value = serde_json::json!({ "ns1": { "id1": { "id": "id1", "title": "A" } }, "ns2": { "id2": { "id": "id2", "title": "B" } } });
        let mut items = Vec::new();
        collect_items(&value, &mut items);
        assert_eq!(items.len(), 2);
    }

    #[test]
    fn catalogo_guardado_em_disco_volta_igual() {
        let dir = std::env::temp_dir().join(format!("launcher-epic-cat-{}", std::process::id()));
        let game = EpicGame { app_name: "A".into(), namespace: "n".into(), catalog_item_id: "i".into(), title: "Jogo".into(), developer: "Dev".into(), description: "d".into(), image_tall: Some("u".into()), image_wide: None };
        let mut cache = CatalogCache::new();
        cache.insert("i".into(), Some(game.clone()));
        cache.insert("dlc".into(), None);
        save_catalog(&dir, &cache);
        assert_eq!(load_catalog(&dir), cache);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn compatibilidade_da_oferta_pertence_ao_jogo_correto() {
        let page: StoreOffers = serde_json::from_str(r#"{
            "elements": [
                {"title":"Racer","tags":[9549],"items":[{"id":"audience","namespace":"ns","nsMajorItems":["ns:racer-pc"]}]},
                {"title":"Puzzle","tags":[9547],"items":[{"id":"puzzle-pc","namespace":"ns"}]}
            ],
            "paging":{"total":2}
        }"#).unwrap();
        let game = |id: &str, title: &str| CatalogGame {
            namespace: "ns".into(), catalog_item_id: id.into(), title: title.into(),
        };
        let supported = |game: CatalogGame| page.elements.iter().any(|offer| offer.tags.contains(&CONTROLLER_TAG) && game.matches(offer));
        assert!(supported(game("racer-pc", "Translated title")));
        assert!(supported(game("another-racer-id", " racer ")));
        assert!(!supported(game("puzzle-pc", "Puzzle")));
        assert!(!supported(game("another-game", "Racer 2")));
    }

    #[test]
    #[ignore = "consulta o catálogo público da Epic pela rede, sem conta"]
    fn etiqueta_da_epic_reconhece_rocket_league() {
        let game = CatalogGame {
            namespace: "9773aa1aa54f4f7b80e44bef04986cea".into(),
            catalog_item_id: "530145df28a24424923f5828cc9031a1".into(),
            title: "Rocket League®".into(),
        };
        let key = game.cache_key();
        assert_eq!(controller_support(vec![game]).unwrap().get(&key), Some(&true));
    }

    #[test]
    fn identificadores_estranhos_sao_recusados() {
        assert!(app_uri("ns", "id", "app", "launch").is_ok());
        assert!(app_uri("ns", "id", "a b", "launch").is_err());
        assert!(app_uri("ns", "id&x=1", "app", "launch").is_err());
        assert!(app_uri("", "id", "app", "launch").is_err());
    }

    #[test]
    fn sessao_guardada_cifrada_e_lida_de_volta() {
        let dir = std::env::temp_dir().join(format!("launcher-epic-{}", std::process::id()));
        let session = StoredSession { account_id: "a".into(), display_name: "Jogador".into(), refresh_token: "segredo".into() };
        save_session(&dir, &session).unwrap();
        let raw = std::fs::read(dir.join(SESSION_FILE)).unwrap();
        assert!(!String::from_utf8_lossy(&raw).contains("segredo"));
        assert_eq!(load_session(&dir).unwrap().display_name, "Jogador");
        assert!(status(&dir).signed_in);
        sign_out(&dir).unwrap();
        assert!(!status(&dir).signed_in);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    #[ignore = "usa a sessão da Epic guardada neste PC e a rede (somente leitura)"]
    fn lista_a_biblioteca_da_conta_deste_pc() {
        let dir = PathBuf::from(std::env::var("APPDATA").unwrap()).join("app.launcher.desktop");
        match fetch_library(&dir) {
            Ok(games) => {
                println!("{} jogo(s) na conta", games.len());
                for g in games.iter().take(15) {
                    println!("  {} [{}] capa={}", g.title, g.app_name, g.image_tall.is_some());
                }
            }
            Err(e) => println!("ERRO: {e}"),
        }
    }

    #[test]
    #[ignore = "lê os manifestos da Epic Games Launcher deste PC (somente leitura)"]
    fn lista_os_jogos_instalados_deste_pc() {
        let games = installed();
        println!("{} jogo(s) instalado(s) pela Epic", games.len());
        for g in &games {
            println!("  {} ({}) em {} · {:?}", g.title, g.app_name, g.install_location, g.launch_executable);
        }
    }
}
