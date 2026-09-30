"""Filtros de cor cinematográficos.

Cada filtro é uma sequência de ajustes de cor (temperatura, contraste em curva S,
saturação, tons divididos nas sombras/luzes, fade...). Eles viram uma LUT 3D:
  * .cube para o ffmpeg (lut3d) na exportação;
  * bytes RGB para o navegador aplicar na prévia (WebGL), com o mesmo resultado.
"""
from __future__ import annotations

import subprocess
from functools import lru_cache
from pathlib import Path

import numpy as np

N = 33  # tamanho da LUT (padrão da indústria)
LUMA = np.array([0.2126, 0.7152, 0.0722], dtype=np.float64)

# Valores pequenos de propósito: looks suaves, sem "cara de Instagram de 2012".
FILTROS = {
    "natural": {"nome": "Natural", "descricao": "Sem filtro"},
    "cinema": {
        "nome": "Cinema", "descricao": "Teal & orange suave de filme de ação",
        "contraste": 0.18, "saturacao": 0.95,
        "sombras": (-0.035, 0.015, 0.055), "luzes": (0.05, 0.015, -0.035), "fade": 0.015,
    },
    "filme_quente": {
        "nome": "Filme Quente", "descricao": "Película clássica, pele bonita",
        "temperatura": 0.35, "contraste": 0.14, "saturacao": 0.92,
        "sombras": (0.0, 0.01, 0.03), "luzes": (0.03, 0.01, -0.02), "fade": 0.03, "suavizar_altas": 0.25,
    },
    "hora_dourada": {
        "nome": "Hora Dourada", "descricao": "Luz de fim de tarde",
        "temperatura": 0.55, "exposicao": 0.03, "contraste": 0.08, "saturacao": 1.05,
        "luzes": (0.05, 0.025, -0.03), "suavizar_altas": 0.3,
    },
    "matte": {
        "nome": "Matte", "descricao": "Pretos lavados, visual editorial",
        "contraste": -0.05, "saturacao": 0.88, "fade": 0.08, "suavizar_altas": 0.2,
        "sombras": (0.0, 0.005, 0.02),
    },
    "nordico": {
        "nome": "Nórdico", "descricao": "Frio, limpo e elegante",
        "temperatura": -0.35, "contraste": 0.1, "saturacao": 0.8,
        "sombras": (-0.01, 0.005, 0.03), "fade": 0.02,
    },
    "bleach": {
        "nome": "Bleach Suave", "descricao": "Contraste prateado, cores contidas",
        "contraste": 0.28, "saturacao": 0.6, "suavizar_altas": 0.15,
    },
    "pastel": {
        "nome": "Pastel", "descricao": "Claro, macio e delicado",
        "exposicao": 0.04, "contraste": -0.12, "saturacao": 0.85, "fade": 0.06,
        "luzes": (0.015, 0.005, 0.02), "suavizar_altas": 0.35,
    },
    "suspense": {
        "nome": "Suspense", "descricao": "Verde-amarelado de thriller",
        "contraste": 0.2, "saturacao": 0.75,
        "sombras": (-0.01, 0.03, 0.015), "luzes": (0.025, 0.03, -0.02), "fade": 0.02,
    },
    "vintage": {
        "nome": "Vintage 70", "descricao": "Filme antigo, quente e desbotado",
        "temperatura": 0.3, "contraste": 0.05, "saturacao": 0.8,
        "sombras": (0.03, 0.0, 0.035), "luzes": (0.04, 0.02, -0.03), "fade": 0.07, "suavizar_altas": 0.3,
    },
    "noir": {
        "nome": "Noir", "descricao": "Preto e branco de cinema",
        "mono": True, "contraste": 0.3, "suavizar_altas": 0.2, "fade": 0.015,
    },
}


def _s(x):
    """Curva S suave (smoothstep)."""
    return x * x * (3 - 2 * x)


def aplicar_ajustes(rgb: np.ndarray, p: dict) -> np.ndarray:
    """Aplica os ajustes do filtro em cores RGB 0..1 (array Nx3)."""
    x = rgb.astype(np.float64).copy()
    t = p.get("temperatura", 0.0)
    if t:
        x[:, 0] *= 1 + 0.07 * t
        x[:, 2] *= 1 - 0.07 * t
    if p.get("exposicao"):
        x = x + p["exposicao"] * (1 - x)
    x = np.clip(x, 0, 1)
    c = p.get("contraste", 0.0)
    if c:
        x = x + c * (_s(x) - x) * 2
    lum = (x @ LUMA)[:, None]
    if p.get("mono"):
        x = np.repeat(lum, 3, axis=1)
    elif "saturacao" in p:
        x = lum + p["saturacao"] * (x - lum)
    lum = np.clip((x @ LUMA)[:, None], 0, 1)
    if "sombras" in p:
        x = x + (1 - lum) ** 2 * np.array(p["sombras"])
    if "luzes" in p:
        x = x + lum ** 2 * np.array(p["luzes"])
    r = p.get("suavizar_altas", 0.0)
    if r:
        # Comprime as altas luzes (rolloff de película) sem mexer no resto.
        x = x - r * 0.25 * np.clip(x - 0.7, 0, None) ** 2 / 0.09
    f = p.get("fade", 0.0)
    if f:
        x = f + x * (1 - f)
    return np.clip(x, 0, 1)


@lru_cache(maxsize=32)
def lut(nome: str, intensidade: float = 1.0) -> np.ndarray:
    """LUT (N,N,N,3) indexada [b][g][r], misturada com a identidade conforme a intensidade."""
    eixo = np.linspace(0, 1, N)
    b, g, r = np.meshgrid(eixo, eixo, eixo, indexing="ij")
    identidade = np.stack([r, g, b], axis=-1).reshape(-1, 3)
    params = FILTROS.get(nome, {})
    if nome == "natural" or not params:
        saida = identidade
    else:
        saida = aplicar_ajustes(identidade, params)
        saida = identidade + (saida - identidade) * float(intensidade)
    return saida.reshape(N, N, N, 3)


def escrever_cube(destino: Path, nome: str, intensidade: float = 1.0) -> None:
    """Formato .cube (Adobe/Resolve): R varia mais rápido, depois G, depois B."""
    valores = lut(nome, round(intensidade, 2)).reshape(-1, 3)
    linhas = [f'TITLE "{FILTROS[nome]["nome"]}"', f"LUT_3D_SIZE {N}"]
    linhas += [f"{r:.6f} {g:.6f} {b:.6f}" for r, g, b in valores]
    destino.write_text("\n".join(linhas) + "\n", encoding="utf-8")


def bytes_para_navegador(nome: str) -> bytes:
    """Textura 2D (N*N de largura, N de altura): a fatia de azul b fica em x = b*N + r."""
    valores = lut(nome, 1.0)                       # [b][g][r]
    textura = valores.transpose(1, 0, 2, 3)        # [g][b][r] -> linha g, colunas (b, r)
    return (np.clip(textura, 0, 1) * 255 + 0.5).astype(np.uint8).tobytes()


def lista():
    return [{"id": k, "nome": v["nome"], "descricao": v["descricao"]} for k, v in FILTROS.items()]


def gerar_miniaturas(previa: Path, pasta: Path, momento: float) -> None:
    """Uma imagem pequena do vídeo com cada filtro, para os botões."""
    pasta.mkdir(parents=True, exist_ok=True)
    base = pasta / "base.png"
    if not base.exists():
        subprocess.run([
            "ffmpeg", "-y", "-v", "error", "-ss", f"{momento:.2f}", "-i", str(previa),
            "-frames:v", "1", "-vf", "scale='if(gt(iw,ih),-2,160)':'if(gt(iw,ih),160,-2)'", str(base),
        ], check=True, capture_output=True)
    for nome in FILTROS:
        destino = pasta / f"{nome}.jpg"
        if destino.exists():
            continue
        cube = pasta / f"{nome}.cube"
        escrever_cube(cube, nome)
        subprocess.run([
            "ffmpeg", "-y", "-v", "error", "-i", "base.png", "-vf", f"lut3d={cube.name}",
            "-q:v", "3", destino.name,
        ], check=True, capture_output=True, cwd=pasta)
        cube.unlink()
