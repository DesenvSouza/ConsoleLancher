//! Controle como mouse e teclado nas janelas da Steam.
//!
//! O controle só dirige a interface do launcher. Quando a Steam abre uma janela dela (o contrato de um jogo, por
//! exemplo), o controle não faz nada nela: a Steam só o transforma em mouse com a configuração de desktop do Steam
//! Input, e o launcher não mexe nas configurações da Steam. Então, enquanto este modo está ligado E uma janela da
//! Steam está na frente, o launcher traduz o controle em mouse e teclado.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
    SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, INPUT_MOUSE, KEYBDINPUT, KEYEVENTF_KEYUP, MOUSEEVENTF_LEFTDOWN,
    MOUSEEVENTF_LEFTUP, MOUSEEVENTF_MOVE, MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP, MOUSEEVENTF_WHEEL, MOUSEINPUT,
    VK_DOWN, VK_ESCAPE, VK_LEFT, VK_RETURN, VK_RIGHT, VK_SHIFT, VK_TAB, VK_UP,
};

/// Por quanto tempo o modo fica ligado se ninguém o desligar (o jogador pode ter ido embora).
const MAX_ON: Duration = Duration::from_secs(15 * 60);

pub const BTN_DPAD_UP: u16 = 0x0001;
pub const BTN_DPAD_DOWN: u16 = 0x0002;
pub const BTN_DPAD_LEFT: u16 = 0x0004;
pub const BTN_DPAD_RIGHT: u16 = 0x0008;
pub const BTN_START: u16 = 0x0010;
pub const BTN_LB: u16 = 0x0100;
pub const BTN_RB: u16 = 0x0200;
pub const BTN_A: u16 = 0x1000;
pub const BTN_B: u16 = 0x2000;
pub const BTN_X: u16 = 0x4000;
pub const BTN_Y: u16 = 0x8000;

static ACTIVE: AtomicBool = AtomicBool::new(false);
static UNTIL: Mutex<Option<Instant>> = Mutex::new(None);

struct Runtime {
    buttons: u16,
    last: Option<Instant>,
    /// Pedaços de pixel que sobraram do último movimento.
    remainder: (f32, f32),
    wheel: f32,
    /// A janela da Steam estava na frente na última checagem.
    steam_front: bool,
    checked: Option<Instant>,
}

static RUNTIME: Mutex<Runtime> = Mutex::new(Runtime { buttons: 0, last: None, remainder: (0.0, 0.0), wheel: 0.0, steam_front: false, checked: None });

pub fn set_active(on: bool) {
    ACTIVE.store(on, Ordering::Relaxed);
    *UNTIL.lock().unwrap() = on.then(|| Instant::now() + MAX_ON);
    let mut rt = RUNTIME.lock().unwrap();
    // Botões que estavam apertados ao ligar não contam como aperto novo (o A que abriu a janela, por exemplo).
    rt.last = None;
    rt.remainder = (0.0, 0.0);
    rt.wheel = 0.0;
}

pub fn is_active() -> bool {
    if !ACTIVE.load(Ordering::Relaxed) {
        return false;
    }
    if UNTIL.lock().unwrap().is_some_and(|until| Instant::now() >= until) {
        ACTIVE.store(false, Ordering::Relaxed);
        return false;
    }
    true
}

/// Uma leitura do controle (chamada a cada ~8 ms pela thread do XInput). Devolve `true` quando o jogador apertou
/// Start para voltar ao launcher: o modo já foi desligado.
pub fn feed(buttons: u16, lx: i16, ly: i16, rx: i16, ry: i16) -> bool {
    let _ = rx;
    if !is_active() {
        return false;
    }
    let now = Instant::now();
    let mut rt = RUNTIME.lock().unwrap();

    // Só traduz com uma janela da Steam na frente: no launcher (ou num jogo), o controle segue o caminho normal.
    if rt.checked.is_none_or(|t| now.duration_since(t) > Duration::from_millis(150)) {
        rt.checked = Some(now);
        rt.steam_front = crate::hide::foreground_is_steam();
    }
    let previous = rt.buttons;
    let dt = rt.last.map_or(0.0, |t| now.duration_since(t).as_secs_f32()).min(0.1);
    let first = rt.last.is_none();
    rt.last = Some(now);
    rt.buttons = buttons;
    if !rt.steam_front {
        return false;
    }
    // O primeiro quadro só registra o que já estava apertado.
    let pressed = if first { 0 } else { buttons & !previous };
    let released = if first { 0 } else { previous & !buttons };

    if pressed & BTN_START != 0 {
        drop(rt);
        set_active(false);
        return true;
    }

    // Analógico esquerdo = cursor (curva quadrática: movimentos finos perto do centro, rápido no fim).
    let (dx, dy) = stick(lx, ly);
    if dx != 0.0 || dy != 0.0 {
        const SPEED: f32 = 1500.0; // pixels por segundo, com o analógico no fim
        rt.remainder.0 += dx * SPEED * dt;
        rt.remainder.1 += -dy * SPEED * dt;
        let (mx, my) = (rt.remainder.0.trunc(), rt.remainder.1.trunc());
        rt.remainder.0 -= mx;
        rt.remainder.1 -= my;
        if mx != 0.0 || my != 0.0 {
            mouse(MOUSEEVENTF_MOVE, mx as i32, my as i32, 0);
        }
    }
    // Analógico direito (vertical) = rolagem.
    let (_, wy) = stick(0, ry);
    if wy != 0.0 {
        rt.wheel += wy * 12.0 * dt; // "cliques" da roda por segundo
        let notches = rt.wheel.trunc();
        if notches != 0.0 {
            rt.wheel -= notches;
            mouse(MOUSEEVENTF_WHEEL, 0, 0, (notches * 120.0) as i32);
        }
    }

    // A = clique, X = clique direito (apertar e soltar acompanham o botão: dá para arrastar).
    if pressed & BTN_A != 0 {
        mouse(MOUSEEVENTF_LEFTDOWN, 0, 0, 0);
    }
    if released & BTN_A != 0 {
        mouse(MOUSEEVENTF_LEFTUP, 0, 0, 0);
    }
    if pressed & BTN_X != 0 {
        mouse(MOUSEEVENTF_RIGHTDOWN, 0, 0, 0);
    }
    if released & BTN_X != 0 {
        mouse(MOUSEEVENTF_RIGHTUP, 0, 0, 0);
    }
    // B = Esc, Y = Enter, direcionais = setas, LB/RB = Shift+Tab / Tab.
    if pressed & BTN_B != 0 {
        key(VK_ESCAPE, false);
    }
    if pressed & BTN_Y != 0 {
        key(VK_RETURN, false);
    }
    if pressed & BTN_DPAD_UP != 0 {
        key(VK_UP, false);
    }
    if pressed & BTN_DPAD_DOWN != 0 {
        key(VK_DOWN, false);
    }
    if pressed & BTN_DPAD_LEFT != 0 {
        key(VK_LEFT, false);
    }
    if pressed & BTN_DPAD_RIGHT != 0 {
        key(VK_RIGHT, false);
    }
    if pressed & BTN_RB != 0 {
        key(VK_TAB, false);
    }
    if pressed & BTN_LB != 0 {
        key(VK_TAB, true);
    }
    false
}

/// Um clique do botão esquerdo na posição atual do cursor.
pub fn click_left() {
    mouse(MOUSEEVENTF_LEFTDOWN, 0, 0, 0);
    std::thread::sleep(Duration::from_millis(60));
    mouse(MOUSEEVENTF_LEFTUP, 0, 0, 0);
}

/// Analógico com zona morta e curva quadrática: de -1 a 1 em cada eixo.
fn stick(x: i16, y: i16) -> (f32, f32) {
    const DEAD: f32 = 8000.0;
    let (fx, fy) = (x as f32, y as f32);
    let magnitude = (fx * fx + fy * fy).sqrt();
    if magnitude <= DEAD {
        return (0.0, 0.0);
    }
    let scaled = ((magnitude - DEAD) / (32767.0 - DEAD)).min(1.0);
    let gain = scaled * scaled / magnitude;
    (fx * gain, fy * gain)
}

fn mouse(flags: u32, dx: i32, dy: i32, data: i32) {
    let input = INPUT {
        r#type: INPUT_MOUSE,
        Anonymous: INPUT_0 { mi: MOUSEINPUT { dx, dy, mouseData: data as u32, dwFlags: flags, time: 0, dwExtraInfo: 0 } },
    };
    // SAFETY: uma estrutura INPUT válida, com o tamanho informado.
    unsafe { SendInput(1, &input, std::mem::size_of::<INPUT>() as i32) };
}

fn key_event(vk: u16, up: bool) -> INPUT {
    INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 { ki: KEYBDINPUT { wVk: vk, wScan: 0, dwFlags: if up { KEYEVENTF_KEYUP } else { 0 }, time: 0, dwExtraInfo: 0 } },
    }
}

/// Aperta e solta uma tecla (com Shift, se pedido).
fn key(vk: u16, shift: bool) {
    let mut events = Vec::with_capacity(4);
    if shift {
        events.push(key_event(VK_SHIFT, false));
    }
    events.push(key_event(vk, false));
    events.push(key_event(vk, true));
    if shift {
        events.push(key_event(VK_SHIFT, true));
    }
    // SAFETY: o vetor tem `len` estruturas INPUT válidas.
    unsafe { SendInput(events.len() as u32, events.as_ptr(), std::mem::size_of::<INPUT>() as i32) };
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn analogico_tem_zona_morta_e_curva() {
        assert_eq!(stick(3000, -3000), (0.0, 0.0));
        let (x, _) = stick(32767, 0);
        assert!((x - 1.0).abs() < 0.01);
        let (half, _) = stick(20000, 0);
        assert!(half > 0.0 && half < 0.4, "curva quadrática: metade do curso fica bem abaixo da metade da velocidade");
    }

    #[test]
    fn desligado_nao_traduz_nada() {
        set_active(false);
        assert!(!feed(BTN_A, 30000, 0, 0, 0));
    }
}
