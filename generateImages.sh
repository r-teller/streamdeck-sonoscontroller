#!/bin/bash
set -euo pipefail

# Rasterizes Material Design SVGs into the PNG icon set the manifest references.
# Requires ImageMagick (`convert`) and the material-design-icons submodule
# (`git submodule update --init --recursive`). Run manually when adding or
# changing icons; outputs are committed under public/images/ so contributors
# without ImageMagick can still build.

VARIANT="outlined" # filled outlined round sharp two-tone
OUT="./public/images"

ACTION_COLOR="#d8d8d8"
ACTION_SIZE=20

KEY_COLOR="#000000"
KEY_BGCOLOR="#d8a158"
KEY_SIZE=72
KEY_ICON_SIZE=40
KEY_RADIUS=14

CATEGORY_COLOR="#c8c8c8"
CATEGORY_SIZE=28

SRC="./material-design-icons/svg/$VARIANT"

mask() {
	KEY_SIZE_2=$((KEY_SIZE * 2))
	KEY_RADIUS_2=$((KEY_RADIUS * 2))
	convert -size ${KEY_SIZE}x${KEY_SIZE} xc:none -draw "roundrectangle 0,0,$KEY_SIZE,$KEY_SIZE,$KEY_RADIUS,$KEY_RADIUS" "mask_$KEY_SIZE.png"
	convert -size ${KEY_SIZE_2}x${KEY_SIZE_2} xc:none -draw "roundrectangle 0,0,$KEY_SIZE_2,$KEY_SIZE_2,$KEY_RADIUS_2,$KEY_RADIUS_2" "mask_$KEY_SIZE_2.png"
}

delmask() {
	rm mask_$KEY_SIZE.png mask_$((KEY_SIZE * 2)).png
}

action() {
	convert -density 1200 -background none -fill "$ACTION_COLOR" -opaque black -resize ${ACTION_SIZE}x${ACTION_SIZE} $SRC/$1.svg $OUT/actions/$2.png
	convert -density 1200 -background none -fill "$ACTION_COLOR" -opaque black -resize $((ACTION_SIZE * 2))x$((ACTION_SIZE * 2)) $SRC/$1.svg $OUT/actions/$2@2x.png
}

category() {
	convert -density 1200 -background none -fill "$CATEGORY_COLOR" -opaque black -resize ${CATEGORY_SIZE}x${CATEGORY_SIZE} $SRC/$1.svg $OUT/category.png
	convert -density 1200 -background none -fill "$CATEGORY_COLOR" -opaque black -resize $((CATEGORY_SIZE * 2))x$((CATEGORY_SIZE * 2)) $SRC/$1.svg $OUT/category@2x.png
}

generateKeyIcon() {
	ICON=$1
	TARGET="$OUT/keys/$2.png"
	SCALE=$3
	SIZE=$((KEY_SIZE * SCALE))
	ICON_SIZE=$((KEY_ICON_SIZE * SCALE))
	convert -density 1200 -background "$KEY_BGCOLOR" -fill "$KEY_COLOR" -opaque black -resize ${ICON_SIZE}x${ICON_SIZE} -gravity Center -extent ${SIZE}x${SIZE} $SRC/$ICON.svg $TARGET
	convert $TARGET -matte "mask_$SIZE.png" -compose DstIn -composite $TARGET
}

key() {
	generateKeyIcon $1 $2 1
	generateKeyIcon $1 $2@2x 2
}

overlay_icon_above() {
	BASE_ICON=$1    # e.g., "shuffle"
	OVERLAY_ICON=$2 # e.g., "looks_one"
	TARGET="$OUT/keys/$3.png"
	SCALE=$4 # Base scale for output size

	SIZE=$((KEY_SIZE * SCALE))
	BASE_ICON_SIZE=$((KEY_ICON_SIZE * SCALE))
	OVERLAY_ICON_SIZE=$((KEY_ICON_SIZE * SCALE / 2)) # Set overlay to half size

	# Centered between top border and base icon
	TOTAL_PADDING=$((SIZE - BASE_ICON_SIZE))
	POSITIONING_OFFSET=$((TOTAL_PADDING / 8))

	convert -density 1200 -background "$KEY_BGCOLOR" -fill "$KEY_COLOR" -opaque black \
		-resize ${BASE_ICON_SIZE}x${BASE_ICON_SIZE} -gravity center -extent ${SIZE}x${SIZE} \
		$SRC/$BASE_ICON.svg base_tmp.png

	convert -density 1200 -background none -fill "$KEY_COLOR" -opaque black \
		-resize ${OVERLAY_ICON_SIZE}x${OVERLAY_ICON_SIZE} -gravity center \
		$SRC/$OVERLAY_ICON.svg overlay_tmp.png

	convert overlay_tmp.png -gravity north -background none -extent ${OVERLAY_ICON_SIZE}x$((OVERLAY_ICON_SIZE + POSITIONING_OFFSET * 2)) overlay_tmp_adjusted.png

	convert base_tmp.png overlay_tmp_adjusted.png -gravity north -geometry +0+$((POSITIONING_OFFSET / 2)) -composite $TARGET

	convert $TARGET -matte "mask_$SIZE.png" -compose DstIn -composite $TARGET

	rm base_tmp.png overlay_tmp.png overlay_tmp_adjusted.png
}

mkdir -p "$OUT/actions" "$OUT/keys" "$OUT/plugin"
mask

action volume_off muted
key volume_off muted
key volume_up unmuted

action motion_photos_pause paused
key motion_photos_pause paused
key play_circle_filled playing
key stop_circle stopped

key slow_motion_video play_normal

action repeat repeat
key repeat_on repeat_all

overlay_icon_above "repeat" "looks_one" "repeat_one" 1
overlay_icon_above "repeat" "looks_one" "repeat_one@2x" 2

action shuffle shuffle
key shuffle shuffle_no_repeat
key shuffle_on shuffle_on

overlay_icon_above "shuffle" "looks_one" "shuffle_one" 1
overlay_icon_above "shuffle" "looks_one" "shuffle_one@2x" 2

action settings_input_component input_source
key queue_music input_sonos_queue
key cable input_line_in
key settings_input_hdmi input_tv

action skip_next next_track
key skip_next next_track

action skip_previous previous_track
key skip_previous previous_track

action expand_more volume_down
key expand_more volume_down

action expand_less volume_up
key expand_less volume_up

action graphic_eq equalizer
key graphic_eq equalizer

action playlist_play play_favorite
key playlist_play play_favorite

action spatial_tracking currently_playing
key spatial_tracking currently_playing

category speaker
delmask
