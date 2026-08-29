import Image from "next/image";
import Link from "next/link";

type BrandLogoProps = {
  compact?: boolean;
  href?: string;
  priority?: boolean;
  className?: string;
};

export default function BrandLogo({
  compact = false,
  href = "/",
  priority = false,
  className = "",
}: BrandLogoProps) {
  return (
    <Link
      href={href}
      className={`ff-brand ff-focus ${compact ? "ff-brand--compact" : ""} ${className}`.trim()}
      aria-label="FinFlow — ir para o início"
    >
      <span className="ff-brand__mark" aria-hidden="true">
        <Image
          src="/finflow-logo.png"
          alt=""
          width={512}
          height={512}
          priority={priority}
          unoptimized
          quality={100}
          sizes="46px"
          className="ff-brand__image"
        />
      </span>
      {!compact && <span className="ff-brand__wordmark"><span>Fin</span><strong>Flow</strong></span>}
    </Link>
  );
}
