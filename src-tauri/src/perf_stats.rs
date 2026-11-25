//! Estatísticas de quadros (FPS, médias, 1% low, frametime) a partir dos instantes em que o jogo apresentou cada quadro.
//!
//! Só contas: sem Windows, sem tempo real. Cada quadro entra com o instante (ms) em que foi apresentado; o tempo de quadro
//! (frametime) é a diferença para o quadro anterior do mesmo jogo.

use serde::Serialize;
use std::collections::VecDeque;

/// Por quanto tempo os quadros contam para a média e para os "lows" (janela móvel).
const WINDOW_MS: f64 = 60_000.0;
/// Janela do FPS "atual": estável o bastante para ler, rápida o bastante para reagir.
const CURRENT_MS: f64 = 1_000.0;
/// O Windows entrega os avisos de quadro em lotes (até ~1 s depois de acontecerem): o "agora" do relógio está sempre um pouco
/// à frente do último quadro recebido. Só depois de tanto tempo sem nenhum quadro novo o jogo conta como parado.
const STALE_MS: f64 = 3_000.0;
/// O frametime mostrado é a média dos quadros deste último trecho: o do último quadro sozinho saltava a cada leitura (os avisos
/// chegam em lotes, então "o último quadro" é um de vários que chegaram juntos).
const FRAMETIME_MS: f64 = 500.0;
/// Intervalos acima disto não são quadros: o jogo pausou, mudou de tela ou perdeu o foco. Reinicia a sequência.
const GAP_MS: f64 = 1_500.0;
/// Quantos tempos de quadro o gráfico recebe.
pub const HISTORY: usize = 120;

#[derive(Default)]
pub struct FrameStats {
    /// (instante em ms, tempo de quadro em ms), do mais antigo ao mais novo.
    frames: VecDeque<(f64, f32)>,
    last_at: Option<f64>,
}

#[derive(Serialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FrameSummary {
    /// FPS do último segundo.
    pub fps: f32,
    /// FPS médio da janela (últimos 60 s).
    pub average: f32,
    /// FPS dos 1% piores quadros (média deles) e dos 0,1% piores.
    pub low1: f32,
    pub low01: f32,
    /// Tempo do último quadro (ms) e o pior dos últimos 120.
    pub frametime: f32,
    pub frametime_max: f32,
    /// Quadros por segundo mínimo e máximo do último segundo (instantâneos).
    pub frames: usize,
    /// Os últimos tempos de quadro (ms), do mais antigo ao mais novo, para o gráfico.
    pub history: Vec<f32>,
}

impl FrameStats {
    /// Registra um quadro apresentado no instante `at_ms`.
    pub fn push(&mut self, at_ms: f64) {
        if let Some(previous) = self.last_at {
            let delta = at_ms - previous;
            if delta > 0.0 && delta <= GAP_MS {
                self.frames.push_back((at_ms, delta as f32));
            } else if delta > GAP_MS {
                // Pausa longa: o que veio antes não faz parte desta sequência.
                self.frames.clear();
            }
        }
        self.last_at = Some(at_ms);
        let oldest = at_ms - WINDOW_MS;
        while self.frames.front().is_some_and(|(t, _)| *t < oldest) {
            self.frames.pop_front();
        }
    }

    pub fn is_empty(&self) -> bool {
        self.frames.is_empty()
    }

    /// Resumo em `now_ms`. Sem quadros novos há `STALE_MS` (o jogo parou de apresentar) o FPS atual é 0.
    ///
    /// O FPS atual conta os quadros do último segundo *até o último quadro recebido*, e não até "agora": os avisos chegam em
    /// lotes, então a janela "agora - 1 s" só teria a parte já entregue e o FPS sairia bem abaixo do real.
    pub fn summary(&self, now_ms: f64) -> FrameSummary {
        let Some(&(last_at, last)) = self.frames.back() else { return FrameSummary::default() };
        let recent_from = last_at - CURRENT_MS;
        let recent = self.frames.iter().filter(|(t, _)| *t > recent_from).count();
        let (span_sum, span_count) = self.frames.iter().rev().take_while(|(t, _)| *t > last_at - FRAMETIME_MS).fold((0.0f64, 0usize), |(sum, n), (_, ft)| (sum + f64::from(*ft), n + 1));
        let frametime = if span_count > 0 { (span_sum / span_count as f64) as f32 } else { last };
        let fps = if self.last_at.is_some_and(|t| now_ms - t > STALE_MS) { 0.0 } else { recent as f32 };

        let times: Vec<f32> = self.frames.iter().map(|(_, ft)| *ft).collect();
        let total: f64 = times.iter().map(|ft| f64::from(*ft)).sum();
        let average = if total > 0.0 { (times.len() as f64 * 1000.0 / total) as f32 } else { 0.0 };

        let history: Vec<f32> = self.frames.iter().rev().take(HISTORY).map(|(_, ft)| *ft).collect::<Vec<_>>().into_iter().rev().collect();
        FrameSummary {
            fps,
            average,
            low1: low(&times, 0.01),
            low01: low(&times, 0.001),
            frametime,
            frametime_max: history.iter().cloned().fold(0.0, f32::max),
            frames: recent,
            history,
        }
    }
}

/// FPS dos `fraction` piores quadros: a média dos maiores tempos de quadro, convertida em FPS.
fn low(times: &[f32], fraction: f64) -> f32 {
    if times.is_empty() {
        return 0.0;
    }
    let mut sorted = times.to_vec();
    sorted.sort_by(|a, b| b.partial_cmp(a).unwrap_or(std::cmp::Ordering::Equal));
    let count = ((times.len() as f64 * fraction).ceil() as usize).clamp(1, sorted.len());
    let mean: f64 = sorted[..count].iter().map(|ft| f64::from(*ft)).sum::<f64>() / count as f64;
    if mean > 0.0 { (1000.0 / mean) as f32 } else { 0.0 }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn steady(fps: f64, seconds: f64) -> (FrameStats, f64) {
        let mut stats = FrameStats::default();
        let step = 1000.0 / fps;
        let mut t = 0.0;
        while t <= seconds * 1000.0 {
            stats.push(t);
            t += step;
        }
        (stats, t - step)
    }

    #[test]
    fn fps_constante() {
        let (stats, now) = steady(60.0, 5.0);
        let s = stats.summary(now);
        assert!((s.fps - 60.0).abs() <= 1.0, "fps {}", s.fps);
        assert!((s.average - 60.0).abs() < 0.2);
        assert!((s.low1 - 60.0).abs() < 0.5);
        assert!((s.frametime - 16.667).abs() < 0.01);
        assert_eq!(s.history.len(), HISTORY);
    }

    #[test]
    fn engasgos_derrubam_o_low_sem_mexer_muito_na_media() {
        let mut stats = FrameStats::default();
        let mut t = 0.0;
        // 990 quadros de 10 ms (100 FPS) e 10 de 100 ms (engasgos): 1% dos quadros.
        for i in 0..1000 {
            stats.push(t);
            t += if i % 100 == 99 { 100.0 } else { 10.0 };
        }
        let s = stats.summary(t);
        assert!(s.low1 < 12.0, "low1 {}", s.low1);
        assert!(s.average > 60.0 && s.average < 100.0, "media {}", s.average);
        assert!(s.low01 <= s.low1 + 0.01);
        assert!((s.frametime_max - 100.0).abs() < 0.01);
    }

    #[test]
    fn pausa_longa_reinicia_a_sequencia() {
        let mut stats = FrameStats::default();
        for i in 0..100 {
            stats.push(f64::from(i) * 16.0);
        }
        // O jogo ficou 10 s parado (menu, minimizado) e voltou.
        stats.push(12_000.0);
        assert!(stats.is_empty());
        stats.push(12_016.0);
        stats.push(12_032.0);
        let s = stats.summary(12_040.0);
        assert!((s.frametime - 16.0).abs() < 0.01);
        assert_eq!(s.history.len(), 2);
    }

    #[test]
    fn frametime_e_a_media_do_ultimo_trecho() {
        // Quadros alternando 10 ms e 30 ms (média 20 ms): o valor mostrado não pode depender de qual veio por último.
        let mut stats = FrameStats::default();
        let mut t = 0.0;
        for i in 0..200 {
            stats.push(t);
            t += if i % 2 == 0 { 10.0 } else { 30.0 };
        }
        let a = stats.summary(t).frametime;
        stats.push(t);
        let b = stats.summary(t + 10.0).frametime;
        assert!((a - 20.0).abs() < 1.0 && (b - 20.0).abs() < 1.0, "{a} {b}");
    }

    #[test]
    fn entrega_atrasada_nao_derruba_o_fps() {
        // O jogo roda a 60 FPS, mas o Windows só entregou os quadros até 0,9 s atrás: o FPS continua 60.
        let (stats, last) = steady(60.0, 5.0);
        let s = stats.summary(last + 900.0);
        assert!((s.fps - 60.0).abs() <= 1.0, "fps {}", s.fps);
        // Com 2,5 s de atraso ainda é o mesmo jogo; passando de 3 s sem quadros novos, parou.
        assert!((stats.summary(last + 2_500.0).fps - 60.0).abs() <= 1.0);
        assert_eq!(stats.summary(last + 3_500.0).fps, 0.0);
    }

    #[test]
    fn sem_quadros_recentes_o_fps_zera() {
        let (stats, now) = steady(60.0, 3.0);
        let s = stats.summary(now + 5_000.0);
        assert_eq!(s.fps, 0.0);
        assert!(s.average > 0.0);
    }

    #[test]
    fn janela_de_60_segundos() {
        let mut stats = FrameStats::default();
        let mut t = 0.0;
        for _ in 0..4000 {
            stats.push(t);
            t += 30.0; // 33 FPS durante 120 s
        }
        assert!(stats.frames.front().is_some_and(|(at, _)| *at >= t - 30.0 - WINDOW_MS - 1.0));
    }

    #[test]
    fn vazio() {
        let stats = FrameStats::default();
        assert_eq!(stats.summary(0.0), FrameSummary::default());
        assert_eq!(low(&[], 0.01), 0.0);
    }
}
