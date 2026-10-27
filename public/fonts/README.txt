cairo-extrabold-name.woff2 is a subset of Cairo ExtraBold (only the letters of the developer name "Shady Mansour"), see OFL-Cairo.txt.
aref-ruqaa-ink-bold-name.woff2 is a subset of Aref Ruqaa Ink Bold (only the letters of the Arabic name "شادي منصور"; the old SVG colour table is removed,
the COLR/CPAL colour layers are kept and recoloured by CSS), see OFL-ArefRuqaaInk.txt. Both fonts are licensed under the SIL Open Font License 1.1.
If the name text ever changes, make the subsets again, for example:
  python3 -m fontTools.subset Cairo_ExtraBold.ttf --text="<new text>" --flavor=woff2 --layout-features="*" --output-file=cairo-extrabold-name.woff2
  python3 -m fontTools.subset Aref_Ruqaa_Ink_Bold.ttf --text="<new text>" --flavor=woff2 --layout-features="*" --drop-tables+=SVG --output-file=aref-ruqaa-ink-bold-name.woff2
