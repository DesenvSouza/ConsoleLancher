//! Controles PlayStation (DualShock 4 e DualSense).
//!
//! O XInput só enxerga controles no padrão Xbox: um controle Sony ligado direto ao PC não aparece nele, então o botão
//! PS nunca abria o menu Guia e o menu não podia ser navegado por esse controle. Aqui os controles Sony são lidos
//! pelo HID (os relatórios de entrada que eles mesmos mandam) e viram o mesmo formato do XInput: o resto do app
//! (menu Guia, launcher) soma esse estado ao dos controles Xbox e não precisa saber de que marca é o controle.
//!
//! Se a Steam (ou o DS4Windows) já faz o controle aparecer como Xbox, ele continua funcionando pelo XInput; os dois
//! estados se somam e o aperto do botão PS tem um intervalo mínimo entre aberturas (ver `guide::toggle_from_pad`).

use std::collections::HashMap;
use std::ffi::CString;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use hidapi::{HidApi, HidDevice};

const SONY: u16 = 0x054c;

#[derive(Clone, Copy, PartialEq, Debug)]
enum Model {
    DualShock4,
    DualSense,
}

fn model(product: u16) -> Option<Model> {
    match product {
        0x05c4 | 0x09cc | 0x0ba0 => Some(Model::DualShock4),
        0x0ce6 | 0x0df2 => Some(Model::DualSense),
        _ => None,
    }
}

/// Estado de um controle Sony no formato do XInput (botões em bits do XInput, direcionais com Y positivo para cima).
#[derive(Clone, Copy, Default, PartialEq, Debug)]
pub struct Reading {
    pub buttons: u16,
    pub lt: u8,
    pub rt: u8,
    pub lx: i16,
    pub ly: i16,
    pub rx: i16,
    pub ry: i16,
    /// Botão PS (o "Guia" do controle). Fica fora de `buttons`, como o Guia do XInput.
    pub ps: bool,
}

/// Onde ficam os campos no relatório de entrada (posições dos bytes).
struct Layout {
    sticks: usize,
    l2: usize,
    r2: usize,
    buttons: usize,
}

fn layout(model: Model, report: &[u8]) -> Option<Layout> {
    let id = *report.first()?;
    let (sticks, l2, r2, buttons) = match (model, id) {
        // USB (relatório completo) e relatório simples do Bluetooth têm o mesmo início no DS4.
        (Model::DualShock4, 0x01) if report.len() >= 10 => (1, 8, 9, 5),
        // Bluetooth em modo completo: dois bytes de cabeçalho a mais.
        (Model::DualShock4, 0x11) if report.len() >= 12 => (3, 10, 11, 7),
        // DualSense por USB: sticks, gatilhos, contador e então os botões.
        (Model::DualSense, 0x01) if report.len() >= 11 => (1, 5, 6, 8),
        // DualSense por Bluetooth em modo simples (10 bytes): botões logo após os sticks.
        (Model::DualSense, 0x01) if report.len() >= 10 => (1, 8, 9, 5),
        // DualSense por Bluetooth em modo completo.
        (Model::DualSense, 0x31) if report.len() >= 12 => (2, 6, 7, 9),
        _ => return None,
    };
    Some(Layout { sticks, l2, r2, buttons })
}

fn stick(raw: u8, up_positive: bool) -> i16 {
    // 0..255 com centro em 128 → -32768..32767.
    let centered = (i32::from(raw) - 128) * 256;
    let value = if up_positive { -centered } else { centered };
    value.clamp(-32768, 32767) as i16
}

/// Lê um relatório de entrada. `None` para relatórios que não são de entrada ou de tamanho desconhecido.
fn parse(model: Model, report: &[u8]) -> Option<Reading> {
    let l = layout(model, report)?;
    let faces = report[l.buttons];
    let shoulders = report[l.buttons + 1];
    let extras = report[l.buttons + 2];

    let mut buttons = 0u16;
    // Direcional digital: 0 = cima, de 45 em 45 graus no sentido horário; 8 = solto.
    match faces & 0x0f {
        0 => buttons |= 0x0001,
        1 => buttons |= 0x0001 | 0x0008,
        2 => buttons |= 0x0008,
        3 => buttons |= 0x0002 | 0x0008,
        4 => buttons |= 0x0002,
        5 => buttons |= 0x0002 | 0x0004,
        6 => buttons |= 0x0004,
        7 => buttons |= 0x0001 | 0x0004,
        _ => {}
    }
    if faces & 0x20 != 0 { buttons |= 0x1000; } // ✕ = A
    if faces & 0x40 != 0 { buttons |= 0x2000; } // ○ = B
    if faces & 0x10 != 0 { buttons |= 0x4000; } // □ = X
    if faces & 0x80 != 0 { buttons |= 0x8000; } // △ = Y
    if shoulders & 0x01 != 0 { buttons |= 0x0100; } // L1 = LB
    if shoulders & 0x02 != 0 { buttons |= 0x0200; } // R1 = RB
    if shoulders & 0x10 != 0 { buttons |= 0x0020; } // Create/Share = Voltar
    if shoulders & 0x20 != 0 { buttons |= 0x0010; } // Options = Start
    if shoulders & 0x40 != 0 { buttons |= 0x0040; } // L3
    if shoulders & 0x80 != 0 { buttons |= 0x0080; } // R3

    Some(Reading {
        buttons,
        lt: report[l.l2],
        rt: report[l.r2],
        lx: stick(report[l.sticks], false),
        ly: stick(report[l.sticks + 1], true),
        rx: stick(report[l.sticks + 2], false),
        ry: stick(report[l.sticks + 3], true),
        ps: extras & 0x01 != 0,
    })
}

/// Soma do estado dos controles Sony conectados (None = nenhum).
static STATE: Mutex<Option<Reading>> = Mutex::new(None);

/// Estado atual dos controles PlayStation, ou `None` se não há nenhum conectado.
pub fn state() -> Option<Reading> {
    *STATE.lock().unwrap()
}

struct Open {
    device: HidDevice,
    model: Model,
    last: Reading,
}

fn merge(into: &mut Reading, from: &Reading) {
    into.buttons |= from.buttons;
    into.lt = into.lt.max(from.lt);
    into.rt = into.rt.max(from.rt);
    for (a, b) in [(&mut into.lx, from.lx), (&mut into.ly, from.ly), (&mut into.rx, from.rx), (&mut into.ry, from.ry)] {
        if b.unsigned_abs() > a.unsigned_abs() {
            *a = b;
        }
    }
}

/// Liga a leitura dos controles Sony. Chamar uma vez.
pub fn start() {
    std::thread::spawn(|| {
        let mut api = match HidApi::new() {
            Ok(api) => api,
            Err(e) => {
                crate::guide::log(&format!("HID indisponível: {e}"));
                return;
            }
        };
        let mut open: HashMap<CString, Open> = HashMap::new();
        let mut last_scan = Instant::now() - Duration::from_secs(10);
        let mut buffer = [0u8; 128];
        loop {
            std::thread::sleep(Duration::from_millis(6));

            // Procurar controles novos custa caro: só de tempos em tempos.
            if last_scan.elapsed() > Duration::from_secs(2) {
                last_scan = Instant::now();
                if api.refresh_devices().is_ok() {
                    for info in api.device_list() {
                        if info.vendor_id() != SONY || open.contains_key(info.path()) {
                            continue;
                        }
                        let Some(model) = model(info.product_id()) else { continue };
                        // O controle é uma coleção "Game Pad" (página 1, uso 5); as outras (movimento, toque) não servem.
                        if info.usage_page() != 0 && !(info.usage_page() == 1 && info.usage() == 5) {
                            continue;
                        }
                        match api.open_path(info.path()) {
                            Ok(device) => {
                                let _ = device.set_blocking_mode(false);
                                crate::guide::log(&format!("controle Sony conectado ({model:?}, {:04x})", info.product_id()));
                                open.insert(info.path().to_owned(), Open { device, model, last: Reading::default() });
                            }
                            Err(e) => crate::guide::log(&format!("não abriu o controle Sony: {e}")),
                        }
                    }
                }
            }

            let mut gone = Vec::new();
            let mut total = Reading::default();
            for (path, pad) in open.iter_mut() {
                loop {
                    match pad.device.read(&mut buffer) {
                        Ok(0) => break,
                        Ok(n) => {
                            if let Some(reading) = parse(pad.model, &buffer[..n]) {
                                if reading.ps && !pad.last.ps {
                                    crate::guide::toggle_from_pad();
                                }
                                pad.last = reading;
                            }
                        }
                        Err(_) => {
                            gone.push(path.clone());
                            break;
                        }
                    }
                }
                merge(&mut total, &pad.last);
            }
            for path in gone {
                crate::guide::log("controle Sony desconectado");
                open.remove(&path);
            }
            *STATE.lock().unwrap() = if open.is_empty() { None } else { Some(total) };
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Relatório USB do DualSense: id 1, sticks, gatilhos, contador, botões.
    fn dualsense_usb() -> Vec<u8> {
        let mut r = vec![0u8; 64];
        r[0] = 0x01;
        r[1..5].copy_from_slice(&[128, 128, 128, 128]);
        r[8] = 0x08; // direcional solto
        r
    }

    #[test]
    fn dualsense_usb_buttons_and_ps() {
        let mut r = dualsense_usb();
        r[8] = 0x08 | 0x20; // ✕ com direcional solto
        r[9] = 0x20; // Options
        r[10] = 0x01; // PS
        r[5] = 200; // L2
        let p = parse(Model::DualSense, &r).unwrap();
        assert_eq!(p.buttons, 0x1000 | 0x0010);
        assert!(p.ps);
        assert_eq!(p.lt, 200);
        assert_eq!(p.lx, 0);
    }

    #[test]
    fn dpad_directions() {
        let mut r = dualsense_usb();
        r[8] = 0; // cima
        assert_eq!(parse(Model::DualSense, &r).unwrap().buttons, 0x0001);
        r[8] = 3; // baixo + direita
        assert_eq!(parse(Model::DualSense, &r).unwrap().buttons, 0x0002 | 0x0008);
        r[8] = 8;
        assert_eq!(parse(Model::DualSense, &r).unwrap().buttons, 0);
    }

    #[test]
    fn stick_up_is_positive() {
        let mut r = dualsense_usb();
        r[2] = 0; // empurrado para cima (no HID, 0 = cima)
        r[1] = 255; // direita
        let p = parse(Model::DualSense, &r).unwrap();
        assert!(p.ly > 30000);
        assert!(p.lx > 30000);
    }

    #[test]
    fn dualshock4_usb_and_bluetooth() {
        let mut usb = vec![0u8; 64];
        usb[0] = 0x01;
        usb[1..5].copy_from_slice(&[128, 128, 128, 128]);
        usb[5] = 0x08 | 0x40; // ○
        usb[6] = 0x01; // L1
        usb[7] = 0x01; // PS
        usb[9] = 255; // R2
        let p = parse(Model::DualShock4, &usb).unwrap();
        assert_eq!(p.buttons, 0x2000 | 0x0100);
        assert!(p.ps);
        assert_eq!(p.rt, 255);

        let mut bt = vec![0u8; 78];
        bt[0] = 0x11;
        bt[3..7].copy_from_slice(&[128, 128, 128, 128]);
        bt[7] = 0x08 | 0x80; // △
        bt[9] = 0x01; // PS
        let p = parse(Model::DualShock4, &bt).unwrap();
        assert_eq!(p.buttons, 0x8000);
        assert!(p.ps);
    }

    #[test]
    fn dualsense_bluetooth_modes() {
        let mut simple = vec![0u8; 10];
        simple[0] = 0x01;
        simple[1..5].copy_from_slice(&[128, 128, 128, 128]);
        simple[5] = 0x08 | 0x10; // □
        simple[7] = 0x01; // PS
        let p = parse(Model::DualSense, &simple).unwrap();
        assert_eq!(p.buttons, 0x4000);
        assert!(p.ps);

        let mut full = vec![0u8; 78];
        full[0] = 0x31;
        full[2..6].copy_from_slice(&[128, 128, 128, 128]);
        full[9] = 0x08;
        full[11] = 0x01; // PS
        let p = parse(Model::DualSense, &full).unwrap();
        assert!(p.ps);
        assert_eq!(p.buttons, 0);
    }

    #[test]
    fn unknown_reports_are_ignored() {
        assert!(parse(Model::DualSense, &[0x05, 0, 0]).is_none());
        assert!(parse(Model::DualShock4, &[]).is_none());
    }

    #[test]
    fn models() {
        assert_eq!(model(0x0ce6), Some(Model::DualSense));
        assert_eq!(model(0x09cc), Some(Model::DualShock4));
        assert_eq!(model(0x0001), None);
    }
}
