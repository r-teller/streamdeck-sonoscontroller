#!/bin/bash

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

overlay_icon() {
	BASE_ICON=$1    # e.g., "shuffle"
	OVERLAY_ICON=$2 # e.g., "looks_one"
	TARGET="$OUT/keys/$3.png"
	SCALE=$4 # Base scale for output size

	SIZE=$((KEY_SIZE * SCALE))
	BASE_ICON_SIZE=$((KEY_ICON_SIZE * SCALE))
	OVERLAY_ICON_SIZE=$((KEY_ICON_SIZE * SCALE / 2)) # Set overlay to half size

	# Create the base icon
	convert -density 1200 -background "$KEY_BGCOLOR" -fill "$KEY_COLOR" -opaque black \
		-resize ${BASE_ICON_SIZE}x${BASE_ICON_SIZE} -gravity center -extent ${SIZE}x${SIZE} \
		$SRC/$BASE_ICON.svg base_tmp.png

	# Create the overlay icon with smaller size
	convert -density 1200 -background none -fill "$KEY_COLOR" -opaque black \
		-resize ${OVERLAY_ICON_SIZE}x${OVERLAY_ICON_SIZE} -gravity center \
		$SRC/$OVERLAY_ICON.svg overlay_tmp.png

	# Combine the base and overlay icons, centering the overlay on the base
	convert base_tmp.png overlay_tmp.png -gravity center -composite $TARGET

	# Apply mask to make rounded corners
	convert $TARGET -matte "mask_$SIZE.png" -compose DstIn -composite $TARGET

	# Clean up temporary files
	rm base_tmp.png overlay_tmp.png
}

overlay_icon_above() {
	BASE_ICON=$1    # e.g., "shuffle"
	OVERLAY_ICON=$2 # e.g., "looks_one"
	TARGET="$OUT/keys/$3.png"
	SCALE=$4 # Base scale for output size

	SIZE=$((KEY_SIZE * SCALE))
	BASE_ICON_SIZE=$((KEY_ICON_SIZE * SCALE))
	OVERLAY_ICON_SIZE=$((KEY_ICON_SIZE * SCALE / 2)) # Set overlay to half size

	# Calculate padding to position overlay centered between top border and shuffle icon
	TOTAL_PADDING=$((SIZE - BASE_ICON_SIZE))  # Total empty space (top and bottom)
	POSITIONING_OFFSET=$((TOTAL_PADDING / 8)) # Offset to center overlay icon in upper half

	# Create the base icon
	convert -density 1200 -background "$KEY_BGCOLOR" -fill "$KEY_COLOR" -opaque black \
		-resize ${BASE_ICON_SIZE}x${BASE_ICON_SIZE} -gravity center -extent ${SIZE}x${SIZE} \
		$SRC/$BASE_ICON.svg base_tmp.png

	# Create the overlay icon with smaller size
	convert -density 1200 -background none -fill "$KEY_COLOR" -opaque black \
		-resize ${OVERLAY_ICON_SIZE}x${OVERLAY_ICON_SIZE} -gravity center \
		$SRC/$OVERLAY_ICON.svg overlay_tmp.png

	# Adjust overlay position by adding padding at the bottom to center it in the upper area
	convert overlay_tmp.png -gravity north -background none -extent ${OVERLAY_ICON_SIZE}x$((OVERLAY_ICON_SIZE + POSITIONING_OFFSET * 2)) overlay_tmp_adjusted.png

	# Combine the base and adjusted overlay icons
	convert base_tmp.png overlay_tmp_adjusted.png -gravity north -geometry +0+$((POSITIONING_OFFSET / 2)) -composite $TARGET

	# Apply mask to make rounded corners
	convert $TARGET -matte "mask_$SIZE.png" -compose DstIn -composite $TARGET

	# Clean up temporary files
	rm base_tmp.png overlay_tmp.png overlay_tmp_adjusted.png
}

mkdir -p $OUT
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
key repeat_on repeat_all # Play Mode == REPEAT_ALL

# Use overlay_icon_above function for single and double resolution
overlay_icon_above "repeat" "looks_one" "repeat_one" 1
overlay_icon_above "repeat" "looks_one" "repeat_one@2x" 2

action shuffle shuffle
key shuffle shuffle_no_repeat # Play Mode == SHUFFLE_NOREPEAT
key shuffle_on shuffle_on     # Play Mode == SHUFFLE

# Use overlay_icon_above function for single and double resolution
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

# action skip_next next
# key skip_next next

# action settings_input_component changesource
# key settings_input_component changesource

# action airplay playuri
# key airplay playuri

# action play_arrow playpause
# key play_arrow paused
# key play_circle_filled playing

# action skip_previous previous
# key skip_previous previous

# action playlist_play playfavorites
# key playlist_play playfavorites

# action repeat repeat
# key repeat repeat_none
# key repeat_on repeat_all
# key repeat_one_on repeat_one

# action shuffle shuffle
# key shuffle shuffle_off
# key shuffle_on shuffle_on

# action volume_up volume
# key volume_up volume

# action volume_down volumedown
# key volume_down volumedown

# action volume_up volumeup
# key volume_up volumeup

category speaker
delmask
