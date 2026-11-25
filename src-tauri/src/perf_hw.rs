//! Hardware para o contador de desempenho: nome do processador e da placa de vídeo, temperatura e uso.
//!
//! Tudo vem de interfaces do próprio Windows, sem driver nem programa extra, e funciona sem ser administrador:
//! - nomes: registro (processador) e o adaptador de vídeo do WDDM;
//! - temperatura, consumo e ventoinha da placa de vídeo: os mesmos dados do Gerenciador de Tarefas (D3DKMT);
//! - uso e memória da placa: contadores de desempenho do Windows (PDH);
//! - temperatura do processador: o Windows não a informa sem um driver de kernel (as zonas térmicas ACPI são da placa-mãe,
//!   não do processador). O campo existe, mas fica vazio e a interface o esconde, em vez de mostrar um número que engana.

use serde::Serialize;
use std::collections::HashMap;
use windows_sys::Wdk::Graphics::Direct3D::{
    D3DKMTCloseAdapter, D3DKMTEnumAdapters2, D3DKMTQueryAdapterInfo, D3DKMT_ADAPTERINFO, D3DKMT_ADAPTERREGISTRYINFO, D3DKMT_ADAPTER_PERFDATA, D3DKMT_CLOSEADAPTER,
    D3DKMT_ENUMADAPTERS2, D3DKMT_QUERYADAPTERINFO, D3DKMT_SEGMENTSIZEINFO, KMTQAITYPE_ADAPTERPERFDATA, KMTQAITYPE_ADAPTERREGISTRYINFO, KMTQAITYPE_GETSEGMENTSIZE,
};
use windows_sys::Win32::Foundation::FILETIME;
use windows_sys::Win32::System::Performance::{
    PdhAddEnglishCounterW, PdhCloseQuery, PdhCollectQueryData, PdhGetFormattedCounterArrayW, PdhOpenQueryW, PDH_FMT_COUNTERVALUE_ITEM_W, PDH_FMT_DOUBLE, PDH_MORE_DATA,
};
use windows_sys::Win32::System::SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX};
use windows_sys::Win32::System::Threading::GetSystemTimes;

#[derive(Serialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GpuInfo {
    /// Nome completo ("NVIDIA GeForce RTX 3060 Ti") e curto ("RTX 3060 Ti").
    pub name: String,
    pub short_name: String,
    /// Uso (0 a 100), temperatura (°C), consumo (% do limite de energia da placa), ventoinha (RPM): `None` quando o driver não informa.
    pub usage: Option<f32>,
    pub temperature: Option<f32>,
    pub power_percent: Option<f32>,
    pub fan_rpm: Option<u32>,
    /// Memória de vídeo usada e total (MB).
    pub vram_used: Option<u32>,
    pub vram_total: Option<u32>,
}

#[derive(Serialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CpuInfo {
    pub name: String,
    pub short_name: String,
    /// Uso (0 a 100).
    pub usage: Option<f32>,
    /// Temperatura (°C). Reservado: hoje nenhuma fonte confiável sem driver de kernel.
    pub temperature: Option<f32>,
}

#[derive(Serialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RamInfo {
    pub used_mb: u32,
    pub total_mb: u32,
}

#[derive(Serialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HwSnapshot {
    pub cpu: CpuInfo,
    pub gpu: GpuInfo,
    pub ram: RamInfo,
}

// ───────── Nomes curtos ─────────

/// "AMD Ryzen 7 7700 8-Core Processor" → "Ryzen 7 7700"; "Intel(R) Core(TM) i7-8700 CPU @ 3.20GHz" → "Core i7-8700".
pub fn short_cpu_name(name: &str) -> String {
    let mut text = name.replace("(R)", "").replace("(TM)", "").replace("(tm)", "").replace("(r)", "");
    if let Some(at) = text.find(" @ ") {
        text.truncate(at);
    }
    let mut words: Vec<&str> = text.split_whitespace().collect();
    let junk = |w: &str| {
        let lower = w.to_lowercase();
        matches!(lower.as_str(), "amd" | "intel" | "cpu" | "processor" | "with" | "radeon" | "graphics" | "apu") || lower.ends_with("-core") || lower == "genuineintel"
    };
    // "Intel Core Ultra 7 265K" mantém "Core Ultra"; só a marca e os sufixos saem.
    words.retain(|w| !junk(w));
    let short = words.join(" ");
    if short.is_empty() { name.trim().to_string() } else { short }
}

/// "NVIDIA GeForce RTX 3060 Ti" → "RTX 3060 Ti"; "AMD Radeon RX 9070 XT" → "RX 9070 XT"; "Intel(R) UHD Graphics 630" → "UHD Graphics 630".
pub fn short_gpu_name(name: &str) -> String {
    let text = name.replace("(R)", "").replace("(TM)", "").replace("(tm)", "").replace("(r)", "");
    let mut words: Vec<&str> = text.split_whitespace().collect();
    words.retain(|w| !matches!(w.to_lowercase().as_str(), "nvidia" | "amd" | "intel" | "geforce" | "radeon" | "corporation"));
    let short = words.join(" ");
    if short.is_empty() { name.trim().to_string() } else { short }
}

// ───────── Processador ─────────

fn cpu_name() -> String {
    use winreg::enums::HKEY_LOCAL_MACHINE;
    use winreg::RegKey;
    RegKey::predef(HKEY_LOCAL_MACHINE)
        .open_subkey(r"HARDWARE\DESCRIPTION\System\CentralProcessor\0")
        .and_then(|key| key.get_value::<String, _>("ProcessorNameString"))
        .map(|name| name.trim().to_string())
        .unwrap_or_default()
}

fn filetime(ft: &FILETIME) -> u64 {
    (u64::from(ft.dwHighDateTime) << 32) | u64::from(ft.dwLowDateTime)
}

fn system_times() -> Option<(u64, u64, u64)> {
    let (mut idle, mut kernel, mut user) = (FILETIME { dwLowDateTime: 0, dwHighDateTime: 0 }, FILETIME { dwLowDateTime: 0, dwHighDateTime: 0 }, FILETIME { dwLowDateTime: 0, dwHighDateTime: 0 });
    // SAFETY: três estruturas válidas, preenchidas pela chamada.
    (unsafe { GetSystemTimes(&mut idle, &mut kernel, &mut user) } != 0).then(|| (filetime(&idle), filetime(&kernel), filetime(&user)))
}

fn ram() -> RamInfo {
    // SAFETY: a estrutura tem o tamanho certo informado em dwLength.
    unsafe {
        let mut status: MEMORYSTATUSEX = std::mem::zeroed();
        status.dwLength = std::mem::size_of::<MEMORYSTATUSEX>() as u32;
        if GlobalMemoryStatusEx(&mut status) == 0 {
            return RamInfo::default();
        }
        let total = status.ullTotalPhys / (1024 * 1024);
        let free = status.ullAvailPhys / (1024 * 1024);
        RamInfo { used_mb: total.saturating_sub(free) as u32, total_mb: total as u32 }
    }
}

// ───────── Contadores de desempenho (PDH) ─────────

struct Counter {
    query: *mut core::ffi::c_void,
    counter: *mut core::ffi::c_void,
}

// SAFETY: os handles do PDH são usados só pela thread que amostra (o amostrador vive numa thread só).
unsafe impl Send for Counter {}

impl Counter {
    fn new(path: &str) -> Option<Counter> {
        let wide: Vec<u16> = path.encode_utf16().chain(std::iter::once(0)).collect();
        let (mut query, mut counter) = (std::ptr::null_mut(), std::ptr::null_mut());
        // SAFETY: ponteiros para variáveis locais e caminho terminado em zero.
        unsafe {
            if PdhOpenQueryW(std::ptr::null(), 0, &mut query) != 0 {
                return None;
            }
            if PdhAddEnglishCounterW(query, wide.as_ptr(), 0, &mut counter) != 0 {
                PdhCloseQuery(query);
                return None;
            }
            // O primeiro dado é só o ponto de partida: os contadores de taxa precisam de duas leituras.
            PdhCollectQueryData(query);
        }
        Some(Counter { query, counter })
    }

    /// Valores de todas as instâncias: (nome da instância, valor).
    fn read(&self) -> Vec<(String, f64)> {
        // SAFETY: o tamanho do buffer é pedido ao PDH e o buffer vive durante as chamadas; os nomes apontam para dentro dele.
        unsafe {
            if PdhCollectQueryData(self.query) != 0 {
                return Vec::new();
            }
            let (mut size, mut count) = (0u32, 0u32);
            let status = PdhGetFormattedCounterArrayW(self.counter, PDH_FMT_DOUBLE, &mut size, &mut count, std::ptr::null_mut());
            if status != PDH_MORE_DATA || size == 0 {
                return Vec::new();
            }
            let mut buffer = vec![0u8; size as usize + 64];
            let items = buffer.as_mut_ptr() as *mut PDH_FMT_COUNTERVALUE_ITEM_W;
            if PdhGetFormattedCounterArrayW(self.counter, PDH_FMT_DOUBLE, &mut size, &mut count, items) != 0 {
                return Vec::new();
            }
            (0..count as usize)
                .filter_map(|i| {
                    let item = &*items.add(i);
                    if item.FmtValue.CStatus != 0 && item.FmtValue.CStatus != 0x0000_0001 {
                        return None;
                    }
                    let mut len = 0;
                    while *item.szName.add(len) != 0 {
                        len += 1;
                    }
                    let name = String::from_utf16_lossy(std::slice::from_raw_parts(item.szName, len));
                    Some((name, item.FmtValue.Anonymous.doubleValue))
                })
                .collect()
        }
    }
}

impl Drop for Counter {
    fn drop(&mut self) {
        // SAFETY: a consulta foi aberta por `Counter::new`.
        unsafe { PdhCloseQuery(self.query) };
    }
}

/// "luid_0x00000000_0x0000F3C1_phys_0_eng_0_engtype_3D" → (luid, número do motor).
fn engine_key(instance: &str) -> Option<(String, String)> {
    let luid = instance.split("_phys_").next()?.split("luid_").nth(1)?.to_string();
    let engine = instance.split("_eng_").nth(1)?.split('_').next()?.to_string();
    Some((luid, engine))
}

/// "luid_0x00000000_0x0000F3C1_phys_0" → "0x00000000_0x0000F3C1".
fn memory_luid(instance: &str) -> Option<String> {
    Some(instance.split("_phys_").next()?.split("luid_").nth(1)?.to_string())
}

// ───────── Placa de vídeo (D3DKMT) ─────────

struct Adapter {
    handle: u32,
    luid: String,
    name: String,
    vram_total_mb: Option<u32>,
}

impl Drop for Adapter {
    fn drop(&mut self) {
        let close = D3DKMT_CLOSEADAPTER { hAdapter: self.handle };
        // SAFETY: o adaptador foi aberto pela enumeração.
        unsafe { D3DKMTCloseAdapter(&close) };
    }
}

fn query<T: Default>(handle: u32, kind: i32) -> Option<T> {
    let mut data = T::default();
    let mut request = D3DKMT_QUERYADAPTERINFO { hAdapter: handle, Type: kind, pPrivateDriverData: &mut data as *mut T as *mut _, PrivateDriverDataSize: std::mem::size_of::<T>() as u32 };
    // SAFETY: o buffer é do tamanho informado; o driver só escreve dentro dele.
    (unsafe { D3DKMTQueryAdapterInfo(&mut request) } == 0).then_some(data)
}

fn adapters() -> Vec<Adapter> {
    let mut list = [D3DKMT_ADAPTERINFO::default(); 16];
    let mut request = D3DKMT_ENUMADAPTERS2 { NumAdapters: list.len() as u32, pAdapters: list.as_mut_ptr() };
    // SAFETY: o buffer tem NumAdapters posições.
    if unsafe { D3DKMTEnumAdapters2(&mut request) } != 0 {
        return Vec::new();
    }
    list.iter()
        .take(request.NumAdapters as usize)
        .filter_map(|info| {
            let reg: D3DKMT_ADAPTERREGISTRYINFO = query(info.hAdapter, KMTQAITYPE_ADAPTERREGISTRYINFO).unwrap_or_else(|| unsafe { std::mem::zeroed() });
            let len = reg.AdapterString.iter().position(|&c| c == 0).unwrap_or(reg.AdapterString.len());
            let name = String::from_utf16_lossy(&reg.AdapterString[..len]);
            let luid = format!("0x{:08X}_0x{:08X}", info.AdapterLuid.HighPart as u32, info.AdapterLuid.LowPart);
            let vram = query::<D3DKMT_SEGMENTSIZEINFO>(info.hAdapter, KMTQAITYPE_GETSEGMENTSIZE).map(|s| (s.DedicatedVideoMemorySize / (1024 * 1024)) as u32);
            Some(Adapter { handle: info.hAdapter, luid, name, vram_total_mb: vram })
        })
        .collect()
}

/// A placa principal: a de mais memória própria (a dedicada, quando há uma integrada junto), ignorando os adaptadores virtuais.
fn main_adapter(list: &[Adapter]) -> Option<&Adapter> {
    list.iter()
        .filter(|a| !a.name.is_empty() && !a.name.to_lowercase().contains("basic render") && !a.name.to_lowercase().contains("remote display"))
        .max_by_key(|a| a.vram_total_mb.unwrap_or(0))
}

/// Temperatura em °C a partir do que o driver informa (décimos de grau).
fn celsius(raw: u32) -> Option<f32> {
    let degrees = raw as f32 / 10.0;
    (raw != 0 && (1.0..=150.0).contains(&degrees)).then_some(degrees)
}

// ───────── Amostrador ─────────

pub struct HwSampler {
    cpu_name: String,
    adapters: Vec<Adapter>,
    gpu_engines: Option<Counter>,
    gpu_memory: Option<Counter>,
    last_times: Option<(u64, u64, u64)>,
}

impl HwSampler {
    pub fn new() -> HwSampler {
        HwSampler {
            cpu_name: cpu_name(),
            adapters: adapters(),
            gpu_engines: Counter::new(r"\GPU Engine(*)\Utilization Percentage"),
            gpu_memory: Counter::new(r"\GPU Adapter Memory(*)\Dedicated Usage"),
            last_times: system_times(),
        }
    }

    /// Uma amostra (chamar uma vez por segundo: o uso é a média desde a última chamada).
    pub fn sample(&mut self) -> HwSnapshot {
        let usage = system_times().and_then(|now| {
            let usage = self.last_times.map(|(idle0, kernel0, user0)| {
                let total = (now.1 + now.2).saturating_sub(kernel0 + user0) as f64;
                let idle = now.0.saturating_sub(idle0) as f64;
                if total > 0.0 { (100.0 * (1.0 - idle / total)).clamp(0.0, 100.0) as f32 } else { 0.0 }
            });
            self.last_times = Some(now);
            usage
        });

        let mut gpu = GpuInfo::default();
        if let Some(adapter) = main_adapter(&self.adapters) {
            gpu.name = adapter.name.clone();
            gpu.short_name = short_gpu_name(&adapter.name);
            gpu.vram_total = adapter.vram_total_mb;
            if let Some(perf) = query::<D3DKMT_ADAPTER_PERFDATA>(adapter.handle, KMTQAITYPE_ADAPTERPERFDATA) {
                gpu.temperature = celsius(perf.Temperature);
                gpu.fan_rpm = (perf.FanRPM > 0).then_some(perf.FanRPM);
                // O Windows informa o consumo em décimos de porcentagem do limite de energia da placa (6,7% = 67): confere com o
                // `nvidia-smi` (13,5 W de 200 W). Em watts, só com a ferramenta de cada fabricante.
                gpu.power_percent = (perf.Power > 0).then(|| perf.Power as f32 / 10.0).filter(|p| *p <= 200.0);
            }
            // Uso: o motor mais ocupado da placa (a soma dos processos em cada motor), como o Gerenciador de Tarefas.
            if let Some(counter) = &self.gpu_engines {
                let mut per_engine: HashMap<String, f64> = HashMap::new();
                for (name, value) in counter.read() {
                    if let Some((luid, engine)) = engine_key(&name) {
                        if luid.eq_ignore_ascii_case(&adapter.luid) {
                            *per_engine.entry(engine + "/" + name.rsplit("engtype_").next().unwrap_or("")).or_default() += value;
                        }
                    }
                }
                gpu.usage = per_engine.values().cloned().fold(None, |best: Option<f64>, v| Some(best.map_or(v, |b| b.max(v)))).map(|v| v.clamp(0.0, 100.0) as f32);
            }
            if let Some(counter) = &self.gpu_memory {
                let used: f64 = counter.read().into_iter().filter(|(name, _)| memory_luid(name).is_some_and(|l| l.eq_ignore_ascii_case(&adapter.luid))).map(|(_, v)| v).sum();
                if used > 0.0 {
                    gpu.vram_used = Some((used / (1024.0 * 1024.0)) as u32);
                }
            }
        }

        let name = self.cpu_name.clone();
        HwSnapshot { cpu: CpuInfo { short_name: short_cpu_name(&name), name, usage, temperature: None }, gpu, ram: ram() }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nomes_curtos_do_processador() {
        assert_eq!(short_cpu_name("AMD Ryzen 7 7700 8-Core Processor"), "Ryzen 7 7700");
        assert_eq!(short_cpu_name("Intel(R) Core(TM) i7-8700 CPU @ 3.20GHz"), "Core i7-8700");
        assert_eq!(short_cpu_name("AMD Ryzen 7 5800X3D 8-Core Processor"), "Ryzen 7 5800X3D");
        assert_eq!(short_cpu_name("Intel(R) Core(TM) Ultra 7 265K"), "Core Ultra 7 265K");
        assert_eq!(short_cpu_name("AMD Ryzen 5 5600G with Radeon Graphics"), "Ryzen 5 5600G");
        assert_eq!(short_cpu_name("Nome Estranho"), "Nome Estranho");
    }

    #[test]
    fn nomes_curtos_da_placa_de_video() {
        assert_eq!(short_gpu_name("NVIDIA GeForce RTX 3060 Ti"), "RTX 3060 Ti");
        assert_eq!(short_gpu_name("AMD Radeon RX 9070 XT"), "RX 9070 XT");
        assert_eq!(short_gpu_name("AMD Radeon(TM) Graphics"), "Graphics");
        assert_eq!(short_gpu_name("Intel(R) UHD Graphics 630"), "UHD Graphics 630");
        assert_eq!(short_gpu_name("NVIDIA"), "NVIDIA");
    }

    #[test]
    fn instancias_dos_contadores() {
        let name = "pid_1234_luid_0x00000000_0x0000F3C1_phys_0_eng_2_engtype_3D";
        assert_eq!(engine_key(name), Some(("0x00000000_0x0000F3C1".to_string(), "2".to_string())));
        assert_eq!(memory_luid("luid_0x00000000_0x0000F3C1_phys_0").as_deref(), Some("0x00000000_0x0000F3C1"));
    }

    #[test]
    fn temperatura_plausivel() {
        assert_eq!(celsius(430), Some(43.0));
        assert_eq!(celsius(0), None);
        assert_eq!(celsius(20_000), None);
    }

    #[test]
    #[ignore = "lê o hardware deste PC"]
    fn amostra_deste_pc() {
        let mut sampler = HwSampler::new();
        std::thread::sleep(std::time::Duration::from_millis(1100));
        let snapshot = sampler.sample();
        println!("{snapshot:#?}");
        assert!(!snapshot.cpu.name.is_empty());
    }
}
