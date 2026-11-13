interface BrandWordmarkProps {
  className?: string;
}

export function BrandWordmark({ className = "" }: BrandWordmarkProps) {
  return (
    <span className={`shadow-matrix-wordmark ${className}`.trim()} role="img" aria-label="Shadow Matrix">
      <span className="shadow-matrix-wordmark__shadow" aria-hidden="true">SHADOW</span>
      <span className="shadow-matrix-wordmark__matrix" aria-hidden="true">MATRIX</span>
    </span>
  );
}
