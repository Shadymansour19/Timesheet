cairo-extrabold-name.woff2 is a subset of Cairo ExtraBold (only the letters of the developer name "Shady Mansour" / "شادي منصور").
Cairo is licensed under the SIL Open Font License 1.1, see OFL-Cairo.txt. If that name text ever changes, make the subset again:
  python3 -m fontTools.subset Cairo_ExtraBold.ttf --text="<new text>" --flavor=woff2 --layout-features="*" --output-file=cairo-extrabold-name.woff2
