# Interactive Ball Game

A fun, interactive React-based web game where you make a black ball move by clicking on the canvas.

## Quick Start

### Prerequisites
- Node.js 18+
- npm or yarn

### Installation & Development

```bash
# Clone the repository
git clone https://github.com/acrm/MemoryLayout.git
cd MemoryLayout

# Install dependencies
npm install

# Start development server
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

### Building for Production

```bash
npm run build
```

Output goes to `dist/` folder.

### GitHub Pages Deployment

GitHub Pages is configured to deploy automatically via GitHub Actions on every push to `main`.

1. Push your code to GitHub:
   ```bash
   git push origin main
   ```

2. Go to repository Settings > Pages > set Source to "GitHub Actions"

3. The workflow will automatically build and deploy your app

4. Access your game at: `https://acrm.github.io/MemoryLayout/`

## Game Controls

Click anywhere on the white canvas to push the ball in that direction. The ball will:
- Accelerate towards your click
- Bounce off canvas edges
- Gradually slow down due to friction

## Technologies Used

- **React 19** - UI framework
- **TypeScript** - Type safety
- **Vite** - Build tool & dev server
- **Canvas API** - 2D graphics rendering

## Project Structure

```
src/
  components/
    BallGame.tsx    # Main game component
  App.tsx          # Root component
  main.tsx         # Entry point
docs/
  GAME_LOGIC.md    # Game mechanics documentation
  TODO.md          # Roadmap and known issues
scripts/
  update-version.js # Version management script
```

## Version Management

This project uses semantic versioning tied to ISO week:
- Format: `<weekCode>-<minor>.<build>`
- Example: `2026w10-0.1`

Version bumps after every code change:
```bash
npm run bump:build -- --desc "Your change description"
npm run bump:minor -- --desc "For breaking changes"
```

## License

MIT License - feel free to use and modify!

## Contributing

1. Make your changes
2. Bump version: `npm run bump:build -- --desc "..."`
3. Validate: `npm run typecheck && npm run build`
4. Commit: `<version>: <description>`
5. Push and create PR

See [AI_AGENT_INSTRUCTIONS.md](./AI_AGENT_INSTRUCTIONS.md) for AI agent workflow guidelines.
