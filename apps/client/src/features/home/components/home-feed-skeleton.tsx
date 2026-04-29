export function HomeFeedSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <div className="aspect-[16/9] w-full animate-pulse rounded-md bg-muted" aria-hidden />
      {Array.from({ length: 4 }).map((_, i) => (
        <section key={i} className="flex flex-col gap-2 px-4 sm:px-6">
          <div className="h-4 w-40 animate-pulse rounded bg-muted" aria-hidden />
          <div className="flex gap-2">
            {Array.from({ length: 6 }).map((_, j) => (
              <div
                key={j}
                className={`${
                  i % 2 === 0 ? "aspect-[2/3]" : "aspect-[16/9]"
                } w-[14%] min-w-32 animate-pulse rounded-md bg-muted`}
                aria-hidden
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
