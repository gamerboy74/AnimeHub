type BrandMarkProps = {
  compact?: boolean;
  showWordmark?: boolean;
  className?: string;
};

export default function BrandMark({ compact = false, showWordmark = false, className = '' }: BrandMarkProps) {
  const iconSize = compact ? 'w-8 h-8' : 'w-12 h-12';
  const wordmarkSize = compact ? 'text-lg' : 'text-xl';

  return (
    <div className={`flex items-center gap-3 ${className}`.trim()}>
      <img
        src="/logo-mark.svg"
        alt="AnimeHub logo"
        className={`${iconSize} flex-shrink-0 object-contain drop-shadow-[0_0_12px_rgba(255,215,0,0.18)]`}
        width={compact ? 32 : 48}
        height={compact ? 32 : 48}
        loading="eager"
        decoding="async"
      />
      {showWordmark && (
        <span className={`font-pacifico ${wordmarkSize} font-bold text-current tracking-wide drop-shadow-sm`}>
          AnimeHub
        </span>
      )}
    </div>
  );
}