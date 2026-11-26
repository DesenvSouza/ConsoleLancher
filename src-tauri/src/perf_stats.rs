//! Estatísticas de quadros (FPS, médias, 1% low, frametime) a partir dos instantes em que o jogo apresentou cada quadro.
//!
//! Só contas: sem Windows, sem tempo real. Cada quadro entra com o instante (ms) em que foi apresentado; o tempo de quadro
//! (frametime) é a diferença para o quadro anterior da mesma superfície do jogo.
//!
//! Regras:
//! - uma travada com o jogo na frente é um quadro lento e **fica** no histórico (o gráfico e os "lows" a mostram);
//! - uma pausa deliberada (jogador no launcher, Alt+Tab) é marcada por quem observa a tela (`pause`) e não vira quadro;
//! - um aviso atrasado ou repetido é descartado sem mexer na referência de tempo;
//! - sem amostra suficiente não há número (`None`), em vez de um número inventado.

use serde::Serialize;
use std::collections::VecDeque;

/// Por quanto tempo os quadros contam para a média e para os "lows" (janela móvel).
const WINDOW_MS: f64 = 60_000.0;
/// Janela do FPS "atual" e do frametime mostrado.
const CURRENT_MS: f64 = 1_000.0;
/// O FPS atual só aparece com pelo menos dois intervalos inteiros e este tanto de tempo coberto.
const MIN_COVERAGE_MS: f64 = 250.0;
const MIN_WHOLE_INTERVALS: usize = 2;
/// Um intervalo maior que isto não é tratado como quadro (computador suspenso, jogo parado em segundo plano).
const MAX_STALL_MS: f64 = 20_000.0;
/// Amostras mínimas para o 1% low e o 0,1% low significarem alguma coisa.
pub const LOW1_SAMPLES: usize = 300;
pub const LOW01_SAMPLES: usize = 3_000;
/// Os "lows" ordenam a janela inteira: são refeitos no máximo uma vez por este tempo.
const LOWS_EVERY_MS: f64 = 1_000.0;
/// Gráfico: um eixo de tempo fixo, dividido em colunas iguais. Cada coluna guarda o pior tempo de quadro que terminou nela.
pub const GRAPH_MS: f64 = 6_000.0;
pub const GRAPH_COLUMNS: usize = 120;

#[derive(Default)]
pub struct FrameStats {
    /// (instante em ms, tempo de quadro em ms), do mais antigo ao mais novo.
    frames: VecDeque<(f64, f32)>,
    last_at: Option<f64>,
    /// O próximo quadro começa um trecho novo: o intervalo até ele não conta.
    paused: bool,
    /// (instante do cálculo, 1% low, 0,1% low).
    lows: Option<(f64, Option<f32>, Option<f32>)>,
}

#[derive(Serialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FrameSummary {
    /// FPS do último segundo coberto por quadros.
    pub fps: Option<f32>,
    /// FPS médio da janela (últimos 60 s).
    pub average: Option<f32>,
    /// FPS dos 1% piores quadros (média deles) e dos 0,1% piores.
    pub low1: Option<f32>,
    pub low01: Option<f32>,
    /// Mediana do tempo de quadro no último segundo (ms).
    pub frametime: Option<f32>,
    /// O pior tempo de quadro dentro do gráfico (ms).
    pub frametime_max: f32,
    /// Idade do último quadro recebido (ms).
    pub age_ms: f64,
    /// Tempos de quadro por coluna do gráfico, da mais antiga à mais nova; `None` = nenhum quadro terminou ali.
    pub history: Vec<Option<f32>>,
}

impl FrameStats {
    /// Registra um quadro apresentado no instante `at_ms`.
    pub fn push(&mut self, at_ms: f64) {
        if let Some(previous) = self.last_at {
            let delta = at_ms - previous;
            // Atrasado ou repetido: não vira quadro e não puxa a referência para trás.
            if delta <= 0.0 {
                return;
            }
            if !self.paused && delta <= MAX_STALL_MS {
                self.frames.push_back((at_ms, delta as f32));
            }
        }
        self.paused = false;
        self.last_at = Some(at_ms);
        let oldest = at_ms - WINDOW_MS;
        while self.frames.front().is_some_and(|(t, _)| *t < oldest) {
            self.frames.pop_front();
        }
    }

    /// Pausa deliberada: o intervalo até o próximo quadro não é um engasgo do jogo.
    pub fn pause(&mut self) {
        self.paused = true;
    }

    /// Quantos quadros terminaram no segundo anterior ao último recebido (para comparar superfícies).
    pub fn recent_frames(&self) -> usize {
        let Some(last) = self.last_at else { return 0 };
        self.frames.iter().rev().take_while(|(t, _)| *t > last - CURRENT_MS).count()
    }

    /// Resumo em `now_ms`. Os números se referem ao tempo coberto até o último quadro recebido (os avisos chegam em lotes);
    /// `age_ms` diz quão antigo é esse último quadro, e quem mostra decide se ainda vale como "agora".
    pub fn summary(&mut self, now_ms: f64) -> FrameSummary {
        let Some(last_at) = self.last_at.filter(|_| !self.frames.is_empty()) else { return FrameSummary::default() };

        // FPS: intervalos (e frações deles) dentro do último segundo, divididos pelo tempo que cobrem.
        let from = last_at - CURRENT_MS;
        let (mut covered, mut fraction, mut whole) = (0.0f64, 0.0f64, 0usize);
        let mut recent: Vec<f32> = Vec::new();
        for &(end, frametime) in self.frames.iter().rev().take_while(|(t, _)| *t > from) {
            let length = f64::from(frametime);
            let inside = length.min(end - from);
            covered += inside;
            fraction += inside / length;
            // Folga para o erro de ponto flutuante na borda da janela.
            if inside >= length - 0.001 {
                whole += 1;
            }
            recent.push(frametime);
        }
        let fps = (whole >= MIN_WHOLE_INTERVALS && covered >= MIN_COVERAGE_MS).then(|| (1000.0 * fraction / covered) as f32);

        recent.sort_by(f32::total_cmp);
        let frametime = (!recent.is_empty()).then(|| {
            let middle = recent.len() / 2;
            if recent.len() % 2 == 0 { (recent[middle - 1] + recent[middle]) / 2.0 } else { recent[middle] }
        });

        let total: f64 = self.frames.iter().map(|(_, ft)| f64::from(*ft)).sum();
        let average = (self.frames.len() >= MIN_WHOLE_INTERVALS && total > 0.0).then(|| (self.frames.len() as f64 * 1000.0 / total) as f32);

        if self.lows.is_none_or(|(at, ..)| now_ms - at >= LOWS_EVERY_MS || now_ms < at) {
            let count = self.frames.len();
            let (low1, low01) = if count >= LOW1_SAMPLES {
                let mut times: Vec<f32> = self.frames.iter().map(|(_, ft)| *ft).collect();
                times.sort_by(|a, b| b.total_cmp(a));
                (low(&times, 0.01), (count >= LOW01_SAMPLES).then(|| low(&times, 0.001)).flatten())
            } else {
                (None, None)
            };
            self.lows = Some((now_ms, low1, low01));
        }
        let (low1, low01) = self.lows.map_or((None, None), |(_, a, b)| (a, b));

        let start = last_at - GRAPH_MS;
        let column = GRAPH_MS / GRAPH_COLUMNS as f64;
        let mut history: Vec<Option<f32>> = vec![None; GRAPH_COLUMNS];
        for &(end, frametime) in self.frames.iter().rev().take_while(|(t, _)| *t > start) {
            let index = (((end - start) / column).ceil() as usize).clamp(1, GRAPH_COLUMNS) - 1;
            history[index] = Some(history[index].map_or(frametime, |worst| worst.max(frametime)));
        }

        FrameSummary {
            fps,
            average,
            low1,
            low01,
            frametime,
            frametime_max: history.iter().flatten().fold(0.0, |a, &b| a.max(b)),
            age_ms: (now_ms - last_at).max(0.0),
            history,
        }
    }
}

/// FPS dos `fraction` piores quadros (`times` do maior para o menor): a média deles, convertida em FPS.
fn low(times: &[f32], fraction: f64) -> Option<f32> {
    if times.is_empty() {
        return None;
    }
    let count = ((times.len() as f64 * fraction).ceil() as usize).clamp(1, times.len());
    let mean: f64 = times[..count].iter().map(|ft| f64::from(*ft)).sum::<f64>() / count as f64;
    (mean > 0.0).then(|| (1000.0 / mean) as f32)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn play(intervals: impl IntoIterator<Item = f64>) -> (FrameStats, f64) {
        let mut stats = FrameStats::default();
        let mut t = 0.0;
        stats.push(t);
        for interval in intervals {
            t += interval;
            stats.push(t);
        }
        (stats, t)
    }

    fn steady(fps: f64, seconds: f64) -> (FrameStats, f64) {
        play(std::iter::repeat_n(1000.0 / fps, (fps * seconds) as usize))
    }

    #[test]
    fn fps_constante_em_varias_taxas() {
        for rate in [4.0, 24.0, 30.0, 59.94, 60.0, 120.0, 144.0, 240.0, 1000.0] {
            let (mut stats, now) = steady(rate, 8.0);
            let s = stats.summary(now);
            let fps = f64::from(s.fps.unwrap_or_else(|| panic!("sem FPS a {rate}")));
            assert!((fps - rate).abs() <= (rate * 0.01).max(0.5), "{rate}: {fps}");
            assert!((f64::from(s.average.unwrap()) - rate).abs() <= (rate * 0.01).max(0.5), "{rate}: media");
        }
    }

    #[test]
    fn sem_amostra_suficiente_nao_inventa_numero() {
        // Um intervalo só: ainda não dá para dizer o FPS nem os "lows".
        let (mut stats, now) = play([16.667]);
        let s = stats.summary(now);
        assert_eq!((s.fps, s.average, s.low1, s.low01), (None, None, None, None));
        let (mut stats, now) = steady(60.0, 6.0);
        let s = stats.summary(now);
        assert!(s.low1.is_some() && s.low01.is_none(), "{s:?}");
    }

    #[test]
    fn engasgos_derrubam_o_low_sem_mexer_muito_na_media() {
        // 990 quadros de 10 ms e 10 de 100 ms (1% dos quadros).
        let (mut stats, now) = play((0..1000).map(|i| if i % 100 == 99 { 100.0 } else { 10.0 }));
        let s = stats.summary(now);
        assert!(s.low1.unwrap() < 12.0, "low1 {:?}", s.low1);
        let average = s.average.unwrap();
        assert!(average > 60.0 && average < 100.0, "media {average}");
        assert!((s.frametime_max - 100.0).abs() < 0.01);
    }

    #[test]
    fn travada_com_o_jogo_na_frente_fica_no_historico() {
        for stall in [80.0, 180.0, 780.0, 1_866.7] {
            let (mut stats, mut now) = steady(60.0, 3.0);
            now += stall;
            stats.push(now);
            let s = stats.summary(now);
            assert!((f64::from(s.frametime_max) - stall).abs() < 1.0, "{stall}: {}", s.frametime_max);
            // O que veio antes continua valendo.
            assert!(s.average.unwrap() > 30.0, "{stall}: {:?}", s.average);
        }
    }

    #[test]
    fn pausa_deliberada_nao_vira_engasgo() {
        let (mut stats, mut now) = steady(60.0, 3.0);
        stats.pause();
        now += 10_000.0;
        stats.push(now);
        for _ in 0..30 {
            now += 1000.0 / 60.0;
            stats.push(now);
        }
        let s = stats.summary(now);
        assert!(s.frametime_max < 20.0, "{}", s.frametime_max);
        assert!((s.fps.unwrap() - 60.0).abs() < 1.0);
    }

    #[test]
    fn aviso_fora_de_ordem_nao_inventa_intervalo() {
        let mut stats = FrameStats::default();
        for at in [0.0, 16.0, 32.0, 24.0, 48.0, 48.0, 64.0] {
            stats.push(at);
        }
        let s = stats.summary(64.0);
        assert!((s.frametime_max - 16.0).abs() < 0.001, "{}", s.frametime_max);
        assert_eq!(stats.frames.len(), 4);
    }

    #[test]
    fn frametime_e_a_mediana_do_ultimo_segundo() {
        let (mut stats, now) = play((0..300).map(|i| if i % 10 == 9 { 60.0 } else { 10.0 }));
        assert!((stats.summary(now).frametime.unwrap() - 10.0).abs() < 0.001);
    }

    #[test]
    fn a_idade_cresce_sem_quadros_novos() {
        let (mut stats, last) = steady(60.0, 3.0);
        let s = stats.summary(last + 1_800.0);
        assert!((s.age_ms - 1_800.0).abs() < 0.01);
        assert!(s.fps.is_some(), "o numero continua descrevendo o trecho recebido");
    }

    #[test]
    fn grafico_tem_eixo_de_tempo() {
        // Mesma duração do gráfico a 30 e a 144 FPS: as colunas cobrem o mesmo tempo.
        for rate in [30.0, 144.0] {
            let (mut stats, now) = steady(rate, 10.0);
            let s = stats.summary(now);
            assert_eq!(s.history.len(), GRAPH_COLUMNS);
            assert!(s.history.iter().filter(|c| c.is_some()).count() >= GRAPH_COLUMNS - 1, "{rate}");
        }
        // Uma travada de 780 ms deixa colunas vazias antes do pico.
        let (mut stats, mut now) = steady(60.0, 8.0);
        now += 780.0;
        stats.push(now);
        let s = stats.summary(now);
        assert_eq!(s.history.last().copied().flatten().map(f32::round), Some(780.0));
        assert!(s.history[GRAPH_COLUMNS - 10].is_none());
    }

    #[test]
    fn janela_de_60_segundos() {
        let (stats, now) = play(std::iter::repeat_n(30.0, 4000));
        assert!(stats.frames.front().is_some_and(|(at, _)| *at >= now - WINDOW_MS - 1.0));
    }

    #[test]
    fn vazio() {
        let mut stats = FrameStats::default();
        assert_eq!(stats.summary(0.0), FrameSummary::default());
        assert_eq!(low(&[], 0.01), None);
    }
}
