function timeAgo(date: Date) {
  const seconds = Math.max(1, Math.round((Date.now() - date.getTime()) / 1000));
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  if (seconds < 60) return rtf.format(-seconds, "second");
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return rtf.format(-minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (hours < 24) return rtf.format(-hours, "hour");
  const days = Math.round(hours / 24);
  if (days < 7) return rtf.format(-days, "day");
  return rtf.format(-Math.round(days / 7), "week");
}

type ProductCardProps = {
  title: string;
  shopName: string;
  productUrl: string;
  imageUrl: string | null;
  firstSeenAt?: Date | null;
  footnote?: string;
};

export function ProductCard({
  title,
  shopName,
  productUrl,
  imageUrl,
  firstSeenAt,
  footnote,
}: ProductCardProps) {
  return (
    <a
      href={productUrl}
      target="_blank"
      rel="noreferrer"
      className="group block border border-white/10 bg-zinc-950"
    >
      <div className="aspect-[4/5] overflow-hidden bg-zinc-900">
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageUrl}
            alt={title}
            className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-xs tracking-widest text-zinc-600 uppercase">
            No image
          </div>
        )}
      </div>
      <div className="space-y-1 px-4 py-4">
        <p className="text-[11px] tracking-[0.2em] text-zinc-500 uppercase">
          {shopName}
        </p>
        <h2 className="text-sm font-medium leading-snug text-zinc-100 group-hover:underline">
          {title}
        </h2>
        {firstSeenAt ? (
          <p className="text-xs text-zinc-500">{timeAgo(firstSeenAt)}</p>
        ) : footnote ? (
          <p className="text-xs text-zinc-500">{footnote}</p>
        ) : null}
      </div>
    </a>
  );
}
