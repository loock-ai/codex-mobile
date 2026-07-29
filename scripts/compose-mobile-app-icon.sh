#!/bin/sh

set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
project_dir=$(dirname -- "$script_dir")

openai_icon=/Applications/ChatGPT.app/Contents/Resources/icon-chatgpt.png
mobile_icon="$project_dir/docs/assets/app-icon/mobile-conversation-icon-white-128.png"
output_icon="$project_dir/docs/assets/app-icon/codex-mobile-app-icon-1024.png"
mobile_x=540
mobile_y=450
mobile_size=400

usage() {
  cat <<'EOF'
用法：
  compose-mobile-app-icon.sh [选项]

选项：
  --x <像素>             手机图层左上角 X 坐标，默认 540
  --y <像素>             手机图层左上角 Y 坐标，默认 450
  --size <像素>          手机图层透明画布尺寸，默认 400
  --base-icon <路径>     OpenAI 原始图标路径
  --mobile-icon <路径>   手机透明图标路径
  --output <路径>        合成结果路径
  -h, --help             显示帮助

示例：
  ./scripts/compose-mobile-app-icon.sh --x 560 --y 510
  ./scripts/compose-mobile-app-icon.sh --x 560 --y 510 --size 400
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --x)
      mobile_x=${2:?--x 缺少数值}
      shift 2
      ;;
    --y)
      mobile_y=${2:?--y 缺少数值}
      shift 2
      ;;
    --size)
      mobile_size=${2:?--size 缺少数值}
      shift 2
      ;;
    --base-icon)
      openai_icon=${2:?--base-icon 缺少路径}
      shift 2
      ;;
    --mobile-icon)
      mobile_icon=${2:?--mobile-icon 缺少路径}
      shift 2
      ;;
    --output)
      output_icon=${2:?--output 缺少路径}
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "未知参数：$1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

for numeric_value in "$mobile_x" "$mobile_y" "$mobile_size"; do
  if ! printf '%s\n' "$numeric_value" | grep -Eq '^-?[0-9]+$'; then
    echo "坐标和尺寸必须是整数：$numeric_value" >&2
    exit 1
  fi
done

if [ "$mobile_size" -le 0 ]; then
  echo "手机图层尺寸必须大于 0。" >&2
  exit 1
fi

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "缺少 ffmpeg，无法合成图标。" >&2
  exit 1
fi

if [ ! -f "$openai_icon" ]; then
  echo "找不到 OpenAI 原始图标：$openai_icon" >&2
  exit 1
fi

if [ ! -f "$mobile_icon" ]; then
  echo "找不到手机图标：$mobile_icon" >&2
  exit 1
fi

mkdir -p "$(dirname -- "$output_icon")"

ffmpeg \
  -y \
  -loglevel error \
  -i "$openai_icon" \
  -i "$mobile_icon" \
  -filter_complex \
  "[0:v]scale=1024:1024:flags=lanczos[base]; \
   [1:v]scale=${mobile_size}:${mobile_size}:flags=lanczos[mobile]; \
   [base][mobile]overlay=x=${mobile_x}:y=${mobile_y}:format=auto,format=rgba[icon]" \
  -map "[icon]" \
  -frames:v 1 \
  "$output_icon"

echo "$output_icon"
