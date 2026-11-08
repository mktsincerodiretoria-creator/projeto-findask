"""Efeitos sonoros cinematográficos sintetizados (sem amostras de terceiros)."""
import sys, subprocess, math
from pathlib import Path
import numpy as np

SR = 48000
OUT = Path(sys.argv[1]); OUT.mkdir(parents=True, exist_ok=True)
rng = np.random.default_rng(7)

def tempo(seg): return np.arange(int(seg * SR)) / SR

def svf(x, cutoff, q=0.7, modo="lp"):
    """Filtro de estado variável (TPT) com corte que pode variar no tempo."""
    n = len(x); cutoff = np.broadcast_to(np.asarray(cutoff, float), (n,)); q = np.broadcast_to(np.asarray(q, float), (n,))
    g = np.tan(np.pi * np.clip(cutoff, 20, SR * 0.45) / SR); k = 1 / q
    a1 = 1 / (1 + g * (g + k)); ic1 = ic2 = 0.0; y = np.empty(n)
    lp, bp, hp = modo == "lp", modo == "bp", modo == "hp"
    for i in range(n):
        v3 = x[i] - ic2; v1 = a1[i] * ic1 + g[i] * a1[i] * v3; v2 = ic2 + g[i] * v1
        ic1 = 2 * v1 - ic1; ic2 = 2 * v2 - ic2
        y[i] = v2 if lp else v1 if bp else x[i] - k[i] * v1 - v2
    return y

def filtro_fft(x, lo=None, hi=None):
    f = np.fft.rfftfreq(len(x), 1 / SR); X = np.fft.rfft(x); m = np.ones_like(f)
    if hi: m *= 1 / np.sqrt(1 + (f / hi) ** 8)
    if lo: m *= 1 / np.sqrt(1 + (lo / np.maximum(f, 1e-3)) ** 8)
    return np.fft.irfft(X * m, len(x))

def reverb(st, rt60=3.0, mix=0.3, escuro=4000, pre=0.02):
    """Reverb por convolução com resposta sintética (ruído decaindo), estéreo descorrelacionado."""
    n_ir = int(rt60 * SR); t = np.arange(n_ir) / SR; dec = np.exp(-6.9 * t / rt60)
    saida = []
    for c in range(2):
        ir = filtro_fft(rng.standard_normal(n_ir), lo=80, hi=escuro) * dec
        ir = np.concatenate([np.zeros(int(pre * SR)), ir]); ir /= np.sqrt(np.sum(ir ** 2))
        x = st[:, c]; n = len(x) + len(ir) - 1; nf = 1 << (n - 1).bit_length()
        saida.append(np.fft.irfft(np.fft.rfft(x, nf) * np.fft.rfft(ir, nf), nf)[:n])
    wet = np.stack(saida, 1); dry = np.zeros_like(wet); dry[: len(st)] = st
    return dry * (1 - mix) + wet * mix * 0.9

def estereo(m, largura=0.0):
    if largura == 0: return np.stack([m, m], 1)
    d = int(largura * SR); r = np.concatenate([np.zeros(d), m[:-d]]); return np.stack([m, r], 1)

def saw(f, t, fase=0.0):
    fase_acum = 2 * np.pi * np.cumsum(np.broadcast_to(f, t.shape)) / SR + fase
    s = np.zeros_like(t)
    for k in range(1, 40):  # serra limitada em banda
        mascara = (k * np.broadcast_to(f, t.shape)) < SR * 0.4
        s += mascara * np.sin(k * fase_acum) / k
    return s * 0.6

def seno(f, t): return np.sin(2 * np.pi * np.cumsum(np.broadcast_to(f, t.shape)) / SR)

def salvar(nome, st, pico_db=-1.0, cauda_seg=None):
    st = np.asarray(st, float)
    if cauda_seg: st = st[: int(cauda_seg * SR)]
    fade = min(len(st), int(0.03 * SR)); st[-fade:] *= np.linspace(1, 0, fade)[:, None]
    st -= st.mean(0)
    st *= 10 ** (pico_db / 20) / (np.abs(st).max() + 1e-9)
    caminho = OUT / f"{nome}.wav"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "f32le", "-ar", str(SR), "-ac", "2", "-i", "-",
                    "-c:a", "pcm_s24le", str(caminho)], input=st.astype("<f4").tobytes(), check=True)
    print(f"{caminho.name}: {len(st) / SR:.1f}s")

def impacto_grave(dur=3.0, f0=90, f1=28, queda=1.2):
    t = tempo(dur); f = f1 + (f0 - f1) * np.exp(-t / 0.18)
    corpo = seno(f, t) * np.exp(-t / queda)
    clique = filtro_fft(rng.standard_normal(len(t)), lo=1500) * np.exp(-t / 0.008) * 0.5
    soco = filtro_fft(rng.standard_normal(len(t)), hi=600) * np.exp(-t / 0.06) * 1.2
    return np.tanh(1.8 * (corpo + clique + soco))

# 1. Abertura: "braam" grave de metais (estilo trailer)
t = tempo(7)
notas = [55, 55 * 1.003, 82.41, 110 * 0.997, 110 * 1.004]
massa = sum(saw(f * (1 + 0.002 * np.sin(2 * np.pi * 0.3 * t + i)), t, i) for i, f in enumerate(notas))
corte = 250 + 1400 * np.exp(-((t - 0.35) / 0.35) ** 2) * (t < 0.35) + 1400 * np.exp(-(t - 0.35) / 1.4) * (t >= 0.35)
env = np.minimum(t / 0.07, 1) * np.exp(-t / 2.8)
braam = np.tanh(2.2 * svf(massa, corte, 0.9) * env) + 0.9 * seno(27.5, t) * env
braam[: int(3 * SR)] += impacto_grave(3.0) * 0.8
salvar("01-abertura-braam", reverb(estereo(braam, 0.012), rt60=4.5, mix=0.35, escuro=2500))

# 2. Impacto sub (queda grave)
salvar("02-impacto-sub-drop", reverb(estereo(impacto_grave(4.5, 110, 26, 1.5)), rt60=4.0, mix=0.3, escuro=1800))

# 3. Riser de tensão (sobe e corta seco)
t = tempo(5); prog = t / 5
ruido = svf(rng.standard_normal(len(t)), 250 * (8000 / 250) ** (prog ** 1.6), 1 + 5 * prog, "bp")
tremolo = 0.6 + 0.4 * np.sin(2 * np.pi * np.cumsum(3 + 22 * prog ** 2) / SR)
tom = sum(seno(f * 2 ** (2 * prog ** 1.5), t) / (j + 1) for j, f in enumerate([110, 165, 220.5, 330]))
riser = (ruido * 1.2 + 0.35 * tom * tremolo) * (prog ** 2.2)
riser[int(4.85 * SR):] = 0
salvar("03-riser-tensao", reverb(estereo(riser, 0.008), rt60=1.6, mix=0.18, escuro=6000), cauda_seg=4.95)

# 4. Whoosh de transição (passa da esquerda para a direita)
t = tempo(2.4); sino = np.exp(-((t - 0.9) / 0.32) ** 2)
w = svf(rng.standard_normal(len(t)), 180 + 3800 * sino, 1.4, "bp") * sino
grave = svf(rng.standard_normal(len(t)), 120 + 300 * sino, 0.8) * sino * 0.8
mono = w + grave; pan = np.clip((t - 0.4) / 1.0, 0, 1)
salvar("04-whoosh-transicao", reverb(np.stack([mono * np.cos(pan * np.pi / 2), mono * np.sin(pan * np.pi / 2)], 1), rt60=1.8, mix=0.25), cauda_seg=2.6)

# 5. Drone sinistro em loop (fundo de explicação)
total, cruz = 24, 4
t = tempo(total)
camadas = [(41.2, 1.0), (61.74, 0.6), (82.41, 0.45), (87.31, 0.18), (123.47, 0.15)]
dr = sum(a * seno(f * (1 + 0.0015 * np.sin(2 * np.pi * (0.05 + 0.02 * i) * t)), t) * (0.75 + 0.25 * np.sin(2 * np.pi * (0.07 + 0.03 * i) * t + i)) for i, (f, a) in enumerate(camadas))
vento = svf(rng.standard_normal(len(t)), 260 + 160 * np.sin(2 * np.pi * 0.04 * t), 2.5, "bp") * 0.5
dr = np.tanh(1.3 * (dr + vento))
st = reverb(estereo(dr, 0.021), rt60=5, mix=0.4, escuro=1500)[: total * SR]
n = cruz * SR; f_in = np.sin(np.linspace(0, np.pi / 2, n))[:, None]
loop = st[n:].copy(); loop[-n:] = loop[-n:] * np.cos(np.linspace(0, np.pi / 2, n))[:, None] + st[:n] * f_in
salvar("05-drone-suspense-loop", np.concatenate([loop[-0:], loop])[: len(loop)], pico_db=-6)

# 6. Batimento cardíaco tenso
t = tempo(8); bat = np.zeros(len(t))
for inicio in np.arange(0.2, 7.6, 0.95):
    for desloc, amp in ((0, 1.0), (0.24, 0.7)):
        i0 = int((inicio + desloc) * SR); tt = tempo(0.35)
        bat[i0: i0 + len(tt)] += amp * seno(48 + 30 * np.exp(-tt / 0.03), tt) * np.exp(-tt / 0.07)
salvar("06-pulso-batimento", reverb(estereo(np.tanh(2 * filtro_fft(bat, hi=180))), rt60=1.2, mix=0.15, escuro=1000))

# 7. Stinger de revelação (golpe metálico escuro)
t = tempo(6)
parciais = [(1, 1.0, 2.5), (2.76, 0.6, 1.6), (5.40, 0.35, 0.9), (8.93, 0.2, 0.5), (13.34, 0.1, 0.3)]
sino_m = sum(a * seno(98 * r, t) * np.exp(-t / d) for r, a, d in parciais)
st7 = sino_m * 0.8 + np.concatenate([impacto_grave(3.0, 80, 30, 1.0), np.zeros(len(t) - 3 * SR)])
salvar("07-stinger-revelacao", reverb(estereo(np.tanh(1.5 * st7), 0.01), rt60=5, mix=0.45, escuro=3000))

# 8. Reverse swell (sucção antes do impacto)
t = tempo(1.2)
golpe = reverb(estereo(impacto_grave(1.2, 140, 40, 0.3) + 0.6 * sum(seno(98 * r, t) * np.exp(-t / 0.4) for r, _, _ in parciais[:3])), rt60=3, mix=0.85, escuro=5000)
salvar("08-reverse-swell", golpe[::-1][-int(3 * SR):])

# 9. Tique-taque de tensão
t = tempo(8); tic = np.zeros(len(t))
for j, inicio in enumerate(np.arange(0.1, 7.9, 0.5)):
    i0 = int(inicio * SR); tt = tempo(0.06); f = 2600 if j % 2 == 0 else 2100
    tic[i0: i0 + len(tt)] += seno(f, tt) * np.exp(-tt / 0.006) + 0.3 * rng.standard_normal(len(tt)) * np.exp(-tt / 0.003)
salvar("09-tique-taque-tensao", reverb(estereo(filtro_fft(tic, lo=600, hi=6000)), rt60=1.5, mix=0.3, escuro=3500), pico_db=-4)

# 10. Entrada de texto sutil (sopro curto + toque grave)
t = tempo(1.2); s = np.exp(-((t - 0.18) / 0.09) ** 2)
txt = svf(rng.standard_normal(len(t)), 400 + 2500 * s, 1.2, "bp") * s * 0.7
toque = impacto_grave(1.2, 120, 55, 0.12) * 0.6; toque = np.concatenate([np.zeros(int(0.2 * SR)), toque[: len(t) - int(0.2 * SR)]])
salvar("10-entrada-texto-sutil", reverb(estereo(txt + toque, 0.006), rt60=1.4, mix=0.25), pico_db=-3)

# ---------- Sons do estilo "edição de suspense" (clarão, texto, palavra, P&B, glitch) ----------

# 11. Clarão de transição: sopro que sobe rápido e estoura num golpe abafado
t = tempo(1.6); sobe = np.clip(t / 0.32, 0, 1) ** 3 * (t < 0.34)
ar = svf(rng.standard_normal(len(t)), 600 + 7000 * sobe, 1.0, "bp") * sobe * 0.9
golpe_f = np.zeros(len(t)); i0 = int(0.33 * SR); g = impacto_grave(1.6 - 0.33, 95, 38, 0.35)
golpe_f[i0:] = g[: len(t) - i0] * 0.9
brilho = filtro_fft(rng.standard_normal(len(t)), lo=3000, hi=12000) * np.exp(-np.maximum(t - 0.33, 0) / 0.05) * (t >= 0.33) * 0.35
salvar("11-flash-transicao", reverb(estereo(ar + golpe_f + brilho, 0.007), rt60=2.2, mix=0.3, escuro=6000))

# 12. Impacto de texto: golpe curto e seco, com um anel metálico grave
t = tempo(2.0)
anel = sum(a * seno(73.4 * r, t) * np.exp(-t / d) for r, a, d in [(1, 0.5, 0.6), (2.76, 0.3, 0.35), (5.4, 0.15, 0.2)])
txt_hit = impacto_grave(2.0, 130, 45, 0.25) + anel
salvar("12-texto-impacto", reverb(estereo(np.tanh(1.6 * txt_hit), 0.005), rt60=1.8, mix=0.22, escuro=3500))

# 13. Pulso de palavra: toque grave e abafado para cada palavra que surge (sutil, sem "plim")
t = tempo(0.5)
pulso_p = seno(62 + 50 * np.exp(-t / 0.02), t) * np.exp(-t / 0.05) + filtro_fft(rng.standard_normal(len(t)), lo=200, hi=1800) * np.exp(-t / 0.012) * 0.25
salvar("13-palavra-pulso", reverb(estereo(np.tanh(1.5 * pulso_p)), rt60=0.9, mix=0.15, escuro=2500), pico_db=-4)

# 14. Boom do preto e branco: grave fundo com cauda distorcida e respiração de ar
t = tempo(3.5)
boom = impacto_grave(3.5, 70, 24, 1.1) * 1.1 + np.tanh(3 * filtro_fft(rng.standard_normal(len(t)), hi=300) * np.exp(-t / 0.5)) * 0.25
salvar("14-pb-boom", reverb(estereo(np.tanh(1.4 * boom), 0.01), rt60=3.2, mix=0.3, escuro=1600))

# 15. Glitch sombrio: picotes digitais curtos, filtrados e graves (para a borda colorida tremendo)
t = tempo(0.7); gl = np.zeros(len(t)); pos = 0.0
while pos < 0.55:
    n_g = int(rng.uniform(0.012, 0.045) * SR); i0 = int(pos * SR); tt = tempo(n_g / SR)
    f = rng.choice([110, 147, 196, 880, 1320])
    bloco = (np.sign(np.sin(2 * np.pi * f * tt)) * 0.5 + rng.standard_normal(n_g) * 0.5) * rng.uniform(0.4, 1)
    gl[i0: i0 + n_g] += bloco[: max(0, min(n_g, len(t) - i0))]
    pos += n_g / SR + rng.uniform(0.0, 0.03)
salvar("15-glitch-sombrio", reverb(estereo(filtro_fft(gl, lo=90, hi=5000), 0.004), rt60=0.8, mix=0.18, escuro=4000), pico_db=-3)
