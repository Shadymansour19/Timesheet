kaushan-script-latin-400.woff2: Kaushan Script (Latin), unmodified, from the @fontsource/kaushan-script package. See OFL-KaushanScript.txt (its Reserved Font Name is "Kaushan Script",
so the file is used as it is and not subset).
aref-ruqaa-ink-bold-name.woff2: a subset of Aref Ruqaa Ink Bold with only the letters of the Arabic name "شادي منصور" (the old SVG colour table is removed, the COLR/CPAL colour
layers are kept and recoloured by CSS). See OFL-ArefRuqaaInk.txt.
Both fonts are licensed under the SIL Open Font License 1.1. To make the Arabic subset again if the name text changes:
  python3 -m fontTools.subset Aref_Ruqaa_Ink_Bold.ttf --text="<new text>" --flavor=woff2 --layout-features="*" --drop-tables+=SVG --output-file=aref-ruqaa-ink-bold-name.woff2
