import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/discover')({
  component: DiscoverPage,
})

function DiscoverPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold mb-2">Discover</h1>
      <p className="text-muted-foreground">Search and browse movies & TV shows</p>
    </div>
  )
}
