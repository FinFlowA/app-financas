type FinancialIconProps = {
  name?: string | null;
  size?: number;
  className?: string;
};

/**
 * Usa a mesma família e os mesmos nomes de Material Icons persistidos pelo
 * aplicativo mobile. A fonte fica empacotada no build do site, sem depender de
 * download externo, e mantém categorias e objetivos visualmente idênticos nas
 * duas plataformas.
 */
export default function FinancialIcon({ name, size = 22, className = "" }: FinancialIconProps) {
  const icon = (name ?? "label").trim();
  const safeIcon = /^[a-z][a-z0-9-]*$/i.test(icon) ? icon : "label";
  const ligature = safeIcon.replaceAll("-", "_");

  return (
    <span
      className={`material-icons ${className}`.trim()}
      aria-hidden="true"
      style={{
        display: "inline-block",
        width: size,
        height: size,
        fontFamily: "'Material Icons'",
        fontSize: size,
        fontFeatureSettings: "'liga'",
        fontStyle: "normal",
        fontWeight: 400,
        letterSpacing: "normal",
        lineHeight: 1,
        overflow: "hidden",
        textTransform: "none",
        whiteSpace: "nowrap",
        WebkitFontFeatureSettings: "'liga'",
        WebkitFontSmoothing: "antialiased",
      }}
    >
      {ligature}
    </span>
  );
}
