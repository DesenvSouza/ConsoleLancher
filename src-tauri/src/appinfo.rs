//! Leitura de `appcache/appinfo.vdf`: os dados de cada jogo que a Steam guarda localmente (tipo, suporte a
//! controle, categorias da loja, tags, compatibilidade com o Steam Deck). Servem para avaliar as coleções
//! *dinâmicas* (filtros salvos), que só dizem "jogos com suporte a controle", não listam os jogos.
//!
//! Formato (versão 41, magic 0x07564429): cabeçalho de 16 bytes (magic, universo, posição da tabela de textos),
//! depois os registros de cada app e, no fim, a tabela de textos usada pelas chaves do VDF binário.

use serde::Serialize;
use std::fs;
use std::path::Path;

#[derive(Serialize, Debug, Clone, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AppMeta {
    pub app_id: String,
    /// `common/type` em minúsculas: "game", "application", "tool", "demo", "music"...
    pub kind: String,
    /// 0 = nenhum, 1 = parcial, 2 = completo (`common/controller_support`).
    pub controller_support: u8,
    /// Categorias da loja (`common/category/category_N`): 28 = controle completo, 18 = parcial, 2 = um jogador...
    pub categories: Vec<u32>,
    /// Tags da loja (`common/store_tags`), como ids de tag.
    pub tags: Vec<u32>,
    /// Compatibilidade com o Steam Deck (`common/steam_deck_compatibility/category`): 1 não suportado, 2 jogável, 3 verificado.
    pub deck: u8,
}

enum Val {
    Map(Vec<(String, Val)>),
    Str(String),
    Int(i64),
}

impl Val {
    fn get(&self, key: &str) -> Option<&Val> {
        match self {
            Val::Map(items) => items.iter().find(|(k, _)| k == key).map(|(_, v)| v),
            _ => None,
        }
    }
    fn as_str(&self) -> Option<&str> {
        if let Val::Str(s) = self { Some(s) } else { None }
    }
    fn as_int(&self) -> Option<i64> {
        match self {
            Val::Int(i) => Some(*i),
            Val::Str(s) => s.parse().ok(),
            _ => None,
        }
    }
    fn items(&self) -> &[(String, Val)] {
        if let Val::Map(items) = self { items } else { &[] }
    }
}

struct Reader<'a> {
    d: &'a [u8],
    p: usize,
}

impl<'a> Reader<'a> {
    fn u8(&mut self) -> Option<u8> {
        let b = *self.d.get(self.p)?;
        self.p += 1;
        Some(b)
    }
    fn take(&mut self, n: usize) -> Option<&'a [u8]> {
        let s = self.d.get(self.p..self.p.checked_add(n)?)?;
        self.p += n;
        Some(s)
    }
    fn u32(&mut self) -> Option<u32> {
        Some(u32::from_le_bytes(self.take(4)?.try_into().ok()?))
    }
    fn u64(&mut self) -> Option<u64> {
        Some(u64::from_le_bytes(self.take(8)?.try_into().ok()?))
    }
    fn cstr(&mut self) -> Option<String> {
        let rest = self.d.get(self.p..)?;
        let end = rest.iter().position(|&b| b == 0)?;
        let s = String::from_utf8_lossy(&rest[..end]).into_owned();
        self.p += end + 1;
        Some(s)
    }
}

/// VDF binário com chaves como índices na tabela de textos.
fn parse_map(r: &mut Reader, strings: &[String]) -> Option<Vec<(String, Val)>> {
    let mut out = Vec::new();
    loop {
        let kind = r.u8()?;
        if kind == 0x08 {
            return Some(out);
        }
        let key = strings.get(r.u32()? as usize)?.clone();
        let value = match kind {
            0x00 => Val::Map(parse_map(r, strings)?),
            0x01 => Val::Str(r.cstr()?),
            0x02 => Val::Int(r.u32()? as i32 as i64),
            0x03 | 0x04 | 0x06 => {
                r.u32()?;
                Val::Int(0)
            }
            0x07 => Val::Int(r.u64()? as i64),
            0x0A => Val::Int(r.u64()? as i64),
            _ => return None,
        };
        out.push((key, value));
    }
}

fn meta_from(app_id: u32, root: &Val) -> Option<AppMeta> {
    let common = root.get("appinfo").unwrap_or(root).get("common")?;
    let controller_support = match common.get("controller_support").and_then(|v| v.as_str()) {
        Some("full") => 2,
        Some("partial") => 1,
        _ => 0,
    };
    let categories = common
        .get("category")
        .map(|c| c.items().iter().filter_map(|(k, v)| (v.as_int()? != 0).then(|| k.strip_prefix("category_")?.parse().ok()).flatten()).collect())
        .unwrap_or_default();
    let tags = common.get("store_tags").map(|t| t.items().iter().filter_map(|(_, v)| v.as_int().map(|i| i as u32)).collect()).unwrap_or_default();
    let deck = common.get("steam_deck_compatibility").and_then(|d| d.get("category")).and_then(|c| c.as_int()).unwrap_or(0) as u8;
    Some(AppMeta {
        app_id: app_id.to_string(),
        kind: common.get("type").and_then(|t| t.as_str()).unwrap_or("").to_lowercase(),
        controller_support,
        categories,
        tags,
        deck,
    })
}

/// Lê todos os apps do arquivo. Apps cujo registro não pôde ser lido são ignorados.
pub fn parse_appinfo(data: &[u8]) -> Vec<AppMeta> {
    let mut head = Reader { d: data, p: 0 };
    let (Some(magic), Some(_universe), Some(table_at)) = (head.u32(), head.u32(), head.u64()) else { return Vec::new() };
    if magic != 0x0756_4429 {
        return Vec::new(); // outra versão do formato
    }

    // Tabela de textos: contagem (u32) e depois os textos terminados em zero.
    let mut t = Reader { d: data, p: table_at as usize };
    let Some(count) = t.u32() else { return Vec::new() };
    let mut strings = Vec::with_capacity(count as usize);
    for _ in 0..count {
        let Some(s) = t.cstr() else { break };
        strings.push(s);
    }

    let mut out = Vec::new();
    let mut r = Reader { d: data, p: 16 };
    while let Some(app_id) = r.u32() {
        if app_id == 0 {
            break;
        }
        let Some(size) = r.u32() else { break };
        let start = r.p;
        let Some(record) = r.take(size as usize) else { break };
        let _ = start;
        // Registro: estado, data, token, hash, número da mudança, hash binário (60 bytes) e depois o VDF.
        if record.len() <= 60 {
            continue;
        }
        let mut body = Reader { d: &record[60..], p: 0 };
        if body.u8() != Some(0x00) || body.u32().is_none() {
            continue; // todo registro começa com o mapa raiz "appinfo"
        }
        if let Some(items) = parse_map(&mut body, &strings) {
            if let Some(meta) = meta_from(app_id, &Val::Map(items)) {
                out.push(meta);
            }
        }
    }
    out
}

pub fn read_appinfo(steam_root: &Path) -> Vec<AppMeta> {
    fs::read(steam_root.join("appcache").join("appinfo.vdf")).map(|d| parse_appinfo(&d)).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Monta um appinfo mínimo (versão 41) com um app, para testar sem depender do arquivo real.
    fn fixture() -> Vec<u8> {
        let strings = ["appinfo", "common", "type", "controller_support", "category", "category_28", "category_2", "store_tags", "0", "steam_deck_compatibility"];
        let idx = |s: &str| strings.iter().position(|x| *x == s).unwrap() as u32;
        let mut vdf: Vec<u8> = Vec::new();
        let key = |v: &mut Vec<u8>, kind: u8, name: &str| {
            v.push(kind);
            v.extend(idx(name).to_le_bytes());
        };
        key(&mut vdf, 0x00, "appinfo");
        key(&mut vdf, 0x00, "common");
        key(&mut vdf, 0x01, "type");
        vdf.extend(b"Game\0");
        key(&mut vdf, 0x01, "controller_support");
        vdf.extend(b"full\0");
        key(&mut vdf, 0x00, "category");
        key(&mut vdf, 0x02, "category_28");
        vdf.extend(1i32.to_le_bytes());
        key(&mut vdf, 0x02, "category_2");
        vdf.extend(1i32.to_le_bytes());
        vdf.push(0x08); // fim de "category"
        key(&mut vdf, 0x00, "store_tags");
        key(&mut vdf, 0x02, "0");
        vdf.extend(492i32.to_le_bytes());
        vdf.push(0x08); // fim de "store_tags"
        key(&mut vdf, 0x00, "steam_deck_compatibility");
        key(&mut vdf, 0x02, "category");
        vdf.extend(3i32.to_le_bytes());
        vdf.push(0x08); // fim de steam_deck_compatibility
        vdf.push(0x08); // fim de "common"
        vdf.push(0x08); // fim de "appinfo"
        vdf.push(0x08); // fim do raiz

        let mut record = vec![0u8; 60];
        record.extend(&vdf);

        let mut file: Vec<u8> = Vec::new();
        file.extend(0x0756_4429u32.to_le_bytes());
        file.extend(1u32.to_le_bytes());
        file.extend(0u64.to_le_bytes()); // posição da tabela: preenchida abaixo
        file.extend(620u32.to_le_bytes());
        file.extend((record.len() as u32).to_le_bytes());
        file.extend(&record);
        file.extend(0u32.to_le_bytes()); // fim dos apps

        let table_at = file.len() as u64;
        file[8..16].copy_from_slice(&table_at.to_le_bytes());
        file.extend((strings.len() as u32).to_le_bytes());
        for s in strings {
            file.extend(s.as_bytes());
            file.push(0);
        }
        file
    }

    #[test]
    fn le_um_app_do_appinfo() {
        let apps = parse_appinfo(&fixture());
        assert_eq!(apps.len(), 1);
        let a = &apps[0];
        assert_eq!(a.app_id, "620");
        assert_eq!(a.kind, "game");
        assert_eq!(a.controller_support, 2);
        assert_eq!(a.categories, vec![28, 2]);
        assert_eq!(a.tags, vec![492]);
        assert_eq!(a.deck, 3);
        assert!(parse_appinfo(&[1, 2, 3]).is_empty(), "arquivo inválido não pode dar pânico");
    }

    /// Leitura real do appinfo desta máquina (só leitura). Só imprime a cobertura.
    #[test]
    fn appinfo_real_somente_leitura() {
        let Some(root) = crate::steam::steam_root() else { return };
        let apps = read_appinfo(&root);
        let with_controller = apps.iter().filter(|a| a.controller_support > 0 || a.categories.contains(&28) || a.categories.contains(&18)).count();
        let with_cats = apps.iter().filter(|a| !a.categories.is_empty()).count();
        let with_tags = apps.iter().filter(|a| !a.tags.is_empty()).count();
        println!("appinfo: {} apps lidos; com categorias={with_cats}; com tags={with_tags}; com suporte a controle={with_controller}", apps.len());
        for kind in ["game", "application", "tool", "demo", "music", "dlc"] {
            println!("  tipo {kind}: {}", apps.iter().filter(|a| a.kind == kind).count());
        }
        // A coleção "Console" da Steam = suporte a controle (parcial ou completo): quantos JOGOS entram?
        let console = |a: &&AppMeta| a.kind == "game" && (a.controller_support >= 1 || a.categories.contains(&28) || a.categories.contains(&18));
        let games = apps.iter().filter(|a| a.kind == "game").count();
        println!("coleção \"Console\" (jogos com suporte a controle): {} de {} jogos", apps.iter().filter(console).count(), games);
    }
}
