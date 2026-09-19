#!/usr/bin/env bash
# Gera a escada de versões de uma cutscene para o cinema-sync: 1080p, 720p e 480p.
#
# As versões ficam com o nome do original + sufixo (ex.: "Cena-720p.mp4"). Carregue-as
# para a MESMA pasta do original no Forge: o módulo encontra-as sozinho pelo nome.
#
# Uso:   bash versoes.sh "caminho/do/video.mp4" [pasta-de-saida]
# Exige: ffmpeg (brew install ffmpeg)
set -euo pipefail

ORIG="${1:?uso: bash versoes.sh video.mp4 [pasta-de-saida]}"
[ -f "$ORIG" ] || { echo "não encontrei: $ORIG" >&2; exit 1; }

BASE="$(basename "${ORIG%.*}")"
SAIDA="${2:-$(dirname "$ORIG")/$BASE - versões}"
mkdir -p "$SAIDA"

ALTURA=$(ffprobe -v error -select_streams v:0 -show_entries stream=height -of csv=p=0 "$ORIG")
AUDIO=$(ffprobe -v error -select_streams a:0 -show_entries stream=codec_name -of csv=p=0 "$ORIG" || true)

# áudio AAC é copiado sem recodificar: todas as versões soam idênticas, e a troca
# de versão a meio da cena não se ouve
if [ "$AUDIO" = "aac" ]; then ARGS_AUDIO=(-c:a copy); else ARGS_AUDIO=(-c:a aac -b:a 192k); fi

gerar() {   # altura crf teto
  local h=$1 crf=$2 teto=$3
  if [ "$ALTURA" -le "$h" ]; then
    echo "· ${h}p: o original já tem ${ALTURA}p, não faz sentido"
    return
  fi
  local destino="$SAIDA/$BASE-${h}p.mp4"
  echo "→ ${h}p"
  # -g 60: um keyframe a cada ~2 s, para a troca de versão saltar rápido para o ponto certo
  ffmpeg -hide_banner -loglevel error -stats -y -i "$ORIG" \
    -map 0:v:0 -map "0:a:0?" \
    -vf "scale=-2:${h}:flags=lanczos" \
    -c:v libx264 -preset medium -profile:v high -pix_fmt yuv420p \
    -crf "$crf" -maxrate "$teto" -bufsize "$((2 * ${teto%M}))M" -g 60 \
    "${ARGS_AUDIO[@]}" -movflags +faststart "$destino"
}

gerar 1080 20 8M
gerar 720  21 4M
gerar 480  22 2M

echo
ls -lh "$SAIDA"
