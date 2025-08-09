import GameCanvas from "@/components/game/GameCanvas";


const Index = () => {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'VideoGame',
    name: 'Phobia 2 Browser Game – Top-Down Shooter Clone',
    applicationCategory: 'Game',
    operatingSystem: 'Web',
    genre: 'Shooter',
    playMode: 'SinglePlayer',
    url: '/',
    description:
      'Play a fast, modern Phobia 2-inspired top-down shooter in your browser. WASD to move, Space to shoot. No downloads.',
  };

  return (
    <>
      <header className="container mx-auto py-8">
        <div className="mx-auto max-w-4xl text-center space-y-4 animate-enter">
          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight">Phobia 2 Browser Game – Top-Down Shooter</h1>
          <p className="text-muted-foreground max-w-3xl mx-auto">
            Dodge waves, blast enemies, and climb the score. WASD / Arrow keys to move, Space to shoot, P to pause.
          </p>
          <div className="flex items-center justify-center gap-3">
            <a href="#play" className="story-link">Jump to Game</a>
          </div>
        </div>
      </header>
      <main id="play" className="container mx-auto pb-12">
        <GameCanvas />
        <section className="mx-auto max-w-4xl mt-8 text-center text-sm text-muted-foreground">
          <p>
            Tip: On desktop, the canvas scales to your window. On mobile, use touch to move and auto-fire with Space where available.
          </p>
        </section>
      </main>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
    </>
  );
};

export default Index;
