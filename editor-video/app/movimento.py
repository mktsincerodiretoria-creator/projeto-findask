"""Movimento de câmera: rastreamento de rosto (tracking) e zooms automáticos.

Tudo é descrito no tempo do vídeo ORIGINAL, como os cortes: assim um zoom
"anda junto" com a fala quando você muda os cortes. A mesma conta (``janela``)
é feita no navegador (prévia) e na exportação, para os dois ficarem iguais.

Um zoom é {id, inicio, fim, intensidade, estilo, origem, ativo}:
  * estilo "suave": aproxima devagar (zoom in) e afasta devagar (zoom out);
  * estilo "corte": aproxima e afasta de uma vez (punch-in), como em vídeos de Reels.
"""
from __future__ import annotations

import bisect
import json
import re
import subprocess
import uuid
from pathlib import Path

import numpy as np

from .analise import intervalos_mantidos
from .legendas import Relogio

MODELO_ROSTO = Path(__file__).resolve().parent / "modelos" / "face_detection_yunet_2023mar.onnx"
AMOSTRAS_POR_S = 4
LADO_ANALISE = 320

ZOOM_MAX = 1.35          # nunca aproxima mais que 35%: "sem exageros"
RAMPA = 0.35             # segundos para aproximar/afastar no estilo suave
ALTURA_ROSTO = 0.10      # deixa o rosto um pouco acima do meio do quadro

MOVIMENTO_PADRAO = {
    "tracking": True,        # o quadro segue o rosto quando está aproximado
    "zoom_base": 0.0,        # aproximação fixa (0 a 0.2) para o tracking ter espaço
    "auto": True,            # zooms automáticos nos momentos de destaque
    "sensibilidade": 0.4,    # 0 = poucos zooms, 1 = muitos
    "intensidade": 0.12,     # 12% de aproximação
    "estilo": "suave",
    "zooms": [],
}


def normalizar(mov: dict | None) -> dict:
    mov = {**MOVIMENTO_PADRAO, **(mov or {})}
    mov["zoom_base"] = min(0.2, max(0.0, float(mov["zoom_base"])))
    mov["sensibilidade"] = min(1.0, max(0.0, float(mov["sensibilidade"])))
    mov["intensidade"] = min(0.25, max(0.03, float(mov["intensidade"])))
    mov["estilo"] = "corte" if mov["estilo"] == "corte" else "suave"
    zooms = []
    for z in mov.get("zooms") or []:
        a, b = float(z["inicio"]), float(z["fim"])
        if b - a < 0.3:
            continue
        zooms.append({
            "id": str(z.get("id") or uuid.uuid4().hex[:10]),
            "inicio": round(a, 3), "fim": round(b, 3),
            "intensidade": min(0.25, max(0.03, float(z.get("intensidade", mov["intensidade"])))),
            "estilo": "corte" if z.get("estilo") == "corte" else "suave",
            "origem": z.get("origem", "manual"),
            "ativo": bool(z.get("ativo", True)),
        })
    mov["zooms"] = sorted(zooms, key=lambda z: z["inicio"])
    return mov


# ---------------------------------------------------------------- curva (igual no app.js)

def _suave(x: float) -> float:
    x = min(1.0, max(0.0, x))
    return x * x * (3 - 2 * x)


def zoom_em(t: float, mov: dict) -> float:
    # Zooms que se sobrepõem não somam: vale o mais forte naquele instante.
    extra = 0.0
    for zm in mov["zooms"]:
        if not zm["ativo"] or t < zm["inicio"] or t > zm["fim"]:
            continue
        if zm["estilo"] == "corte":
            e = 1.0
        else:
            r = min(RAMPA, (zm["fim"] - zm["inicio"]) / 3)
            e = _suave(min((t - zm["inicio"]) / r, (zm["fim"] - t) / r, 1.0))
        extra = max(extra, zm["intensidade"] * e)
    return min(1.0 + mov["zoom_base"] + extra, ZOOM_MAX)


def centro_em(t: float, mov: dict, trilha: dict | None) -> tuple[float, float]:
    if not mov["tracking"] or not trilha or not trilha.get("t"):
        return 0.5, 0.5
    ts, xs, ys = trilha["t"], trilha["x"], trilha["y"]
    if t <= ts[0]:
        return xs[0], ys[0]
    if t >= ts[-1]:
        return xs[-1], ys[-1]
    i = bisect.bisect_right(ts, t) - 1
    f = (t - ts[i]) / (ts[i + 1] - ts[i])
    return xs[i] + (xs[i + 1] - xs[i]) * f, ys[i] + (ys[i + 1] - ys[i]) * f


def janela(t: float, mov: dict, trilha: dict | None) -> tuple[float, float, float]:
    """(zoom, x0, y0): o recorte do quadro original, em frações (0..1), no tempo original t."""
    z = zoom_em(t, mov)
    w = 1.0 / z
    fx, fy = centro_em(t, mov, trilha)
    cx = min(max(fx, w / 2), 1 - w / 2)
    cy = min(max(fy + ALTURA_ROSTO * w, w / 2), 1 - w / 2)
    return z, cx - w / 2, cy - w / 2


def tem_efeito(mov: dict) -> bool:
    return mov["zoom_base"] > 0.001 or any(z["ativo"] for z in mov["zooms"])


# ---------------------------------------------------------------- rastreamento de rosto

def _detector(largura: int, altura: int):
    import cv2

    if hasattr(cv2, "FaceDetectorYN") and MODELO_ROSTO.exists():
        det = cv2.FaceDetectorYN.create(str(MODELO_ROSTO), "", (largura, altura), 0.6)

        def detectar(img):
            _, faces = det.detect(img)
            if faces is None:
                return []
            return [(f[0], f[1], f[2], f[3], float(f[-1])) for f in faces]
        return detectar

    # Plano B: detector clássico que vem dentro do OpenCV.
    cascata = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")

    def detectar(img):
        cinza = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        return [(x, y, w, h, 1.0) for x, y, w, h in cascata.detectMultiScale(cinza, 1.15, 5, minSize=(24, 24))]
    return detectar


def detectar_rosto(video: Path, largura: int, altura: int, progresso=None, duracao: float = 0) -> list:
    """Amostras [t, x, y, tamanho] (frações do quadro) ou [t, None, None, None] sem rosto."""
    if largura >= altura:
        lw, lh = LADO_ANALISE * largura // altura, LADO_ANALISE
    else:
        lw, lh = LADO_ANALISE, LADO_ANALISE * altura // largura
    lw, lh = lw // 2 * 2, lh // 2 * 2
    detectar = _detector(lw, lh)
    proc = subprocess.Popen(
        ["ffmpeg", "-v", "error", "-i", str(video), "-vf", f"fps={AMOSTRAS_POR_S},scale={lw}:{lh}",
         "-f", "rawvideo", "-pix_fmt", "bgr24", "pipe:1"],
        stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
    )
    tamanho = lw * lh * 3
    amostras, anterior, n = [], None, 0
    while True:
        bruto = proc.stdout.read(tamanho)
        if len(bruto) < tamanho:
            break
        img = np.frombuffer(bruto, np.uint8).reshape(lh, lw, 3)
        rostos = detectar(img)
        t = n / AMOSTRAS_POR_S
        if rostos:
            def nota(r):
                x, y, w, h, s = r
                c = ((x + w / 2) / lw, (y + h / 2) / lh)
                perto = 0.0 if anterior is None else abs(c[0] - anterior[0]) + abs(c[1] - anterior[1])
                return w * h * s - perto * lw * lh * 0.05   # maior rosto, de preferência o mesmo de antes
            x, y, w, h, _ = max(rostos, key=nota)
            anterior = ((x + w / 2) / lw, (y + h / 2) / lh)
            amostras.append([round(t, 3), round(anterior[0], 4), round(anterior[1], 4), round(w / lw, 4)])
        else:
            amostras.append([round(t, 3), None, None, None])
        n += 1
        if progresso and duracao:
            progresso(min(1.0, t / duracao))
    proc.wait()
    return amostras


def _media_movel(v: np.ndarray, janela: int) -> np.ndarray:
    if janela <= 1 or len(v) < 2:
        return v
    k = np.ones(janela) / janela
    borda = janela // 2
    return np.convolve(np.pad(v, (borda, janela - 1 - borda), mode="edge"), k, mode="valid")


def suavizar(amostras: list, segundos: float = 1.2) -> dict:
    """Trilha suave do rosto: {t, x, y, cobertura}. Sem rosto suficiente, trilha vazia."""
    if not amostras:
        return {"t": [], "x": [], "y": [], "cobertura": 0.0}
    t = np.array([a[0] for a in amostras], float)
    ok = np.array([a[1] is not None for a in amostras])
    cobertura = float(ok.mean())
    if cobertura < 0.2:
        return {"t": [], "x": [], "y": [], "cobertura": round(cobertura, 3)}
    x = np.interp(t, t[ok], np.array([a[1] for a in amostras if a[1] is not None], float))
    y = np.interp(t, t[ok], np.array([a[2] for a in amostras if a[2] is not None], float))
    janela = max(1, int(round(segundos * AMOSTRAS_POR_S)))
    # Duas médias móveis seguidas ≈ suavização gaussiana: o quadro "flutua", não treme.
    x = _media_movel(_media_movel(x, janela), janela)
    y = _media_movel(_media_movel(y, janela), janela)
    return {
        "t": [round(float(v), 3) for v in t],
        "x": [round(float(v), 4) for v in x],
        "y": [round(float(v), 4) for v in y],
        "cobertura": round(cobertura, 3),
    }


def salvar_trilha(pasta: Path, trilha: dict) -> None:
    (pasta / "rosto.json").write_text(json.dumps(trilha), encoding="utf-8")


def carregar_trilha(pasta: Path) -> dict | None:
    arq = pasta / "rosto.json"
    return json.loads(arq.read_text(encoding="utf-8")) if arq.exists() else None


# ---------------------------------------------------------------- zooms automáticos

def gerar_zooms(palavras: list, cortes: list, duracao: float, mov: dict, ocupados: list | None = None) -> list:
    """Coloca zooms nos começos de frase, espaçados conforme a sensibilidade.
    Perguntas, exclamações e frases depois de uma pausa têm prioridade."""
    relogio = Relogio(intervalos_mantidos(cortes, duracao))
    n = len(palavras)
    candidatos = []
    for i, p in enumerate(palavras):
        if not relogio.contem((p["inicio"] + p["fim"]) / 2):
            continue
        pausa = p["inicio"] - palavras[i - 1]["fim"] if i else 99.0
        if i and pausa < 0.3 and not re.search(r"[.!?…]$", palavras[i - 1]["texto"].strip()):
            continue  # não é começo de frase
        j = i
        while (j + 1 < n and palavras[j + 1]["inicio"] - palavras[j]["fim"] < 0.3
               and not re.search(r"[.!?…]$", palavras[j]["texto"].strip())
               and palavras[j + 1]["fim"] - p["inicio"] < 4.0):
            j += 1
        peso = 1.0
        if re.search(r"[!?]", palavras[j]["texto"]):
            peso += 0.6
        if pausa >= 0.6:
            peso += 0.3
        candidatos.append((p["inicio"], palavras[j]["fim"], peso))

    intervalo = 14.0 - 10.0 * mov["sensibilidade"]   # 14 s (poucos) até 4 s (muitos) entre zooms
    zooms, fim_anterior = [], -1e9
    ocupados = [(z["inicio"] - 1.5, z["fim"] + 1.5) for z in (ocupados or [])]
    for a, b, peso in candidatos:
        if any(a < fim and b > ini for ini, fim in ocupados):
            continue  # perto de um zoom que você colocou: não põe outro em cima
        a_final = relogio(a)
        if a_final - fim_anterior < intervalo / peso:
            continue
        b = min(max(b, a + 1.2), a + 4.0, duracao)
        if b - a < 0.8:
            continue
        # Alterna intensidades para não ficar repetitivo.
        intens = mov["intensidade"] * (1.0 if len(zooms) % 2 == 0 else 0.7)
        zooms.append({
            "id": uuid.uuid4().hex[:10], "inicio": round(a, 3), "fim": round(b, 3),
            "intensidade": round(intens, 3), "estilo": mov["estilo"],
            "origem": "auto", "ativo": True,
        })
        fim_anterior = relogio(b)
    return zooms


def refazer_automaticos(mov: dict, palavras: list, cortes: list, duracao: float) -> dict:
    mov = normalizar(mov)
    manuais = [z for z in mov["zooms"] if z["origem"] != "auto"]
    novos = gerar_zooms(palavras, cortes, duracao, mov, manuais) if mov["auto"] else []
    mov["zooms"] = sorted(manuais + novos, key=lambda z: z["inicio"])
    return mov
