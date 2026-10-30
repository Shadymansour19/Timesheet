kaushan-script-latin-400.woff2: Kaushan Script (Latin), unmodified, from the @fontsource/kaushan-script package. See OFL-KaushanScript.txt (its Reserved Font Name is "Kaushan Script",
so the file is used as it is and not subset).
aref-ruqaa-ink-bold-name.woff2: a subset of Aref Ruqaa Ink Bold with only the letters of the Arabic name "شادي منصور" (the old SVG colour table is removed, the COLR/CPAL colour
layers are kept and recoloured by CSS). See OFL-ArefRuqaaInk.txt.
Both fonts are licensed under the SIL Open Font License 1.1. To make the Arabic subset again if the name text changes:
  python3 -m fontTools.subset Aref_Ruqaa_Ink_Bold.ttf --text="<new text>" --flavor=woff2 --layout-features="*" --drop-tables+=SVG --output-file=aref-ruqaa-ink-bold-name.woff2

noto-naskh-arabic-regular.woff2 / noto-naskh-arabic-bold.woff2: subsets of Noto Naskh Arabic Regular and Bold (Arabic blocks, digits, a few punctuation marks; layout features kept),
used by the overtime form (print / PDF) so it looks the same on every machine. SIL Open Font License 1.1, see OFL-NotoNaskhArabic.txt. To make them again:
  python3 -m fontTools.subset NotoNaskhArabic-Regular.ttf --unicodes="U+0020,U+0030-0039,U+0600-06FF,U+0750-077F,U+08A0-08FF,U+200C-200F,U+2010-2015,U+2018-201D,U+FB50-FDFF,U+FE70-FEFF" --flavor=woff2 --layout-features='*' --output-file=noto-naskh-arabic-regular.woff2
