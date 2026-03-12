# Game Logic

## Overview

Interactive Ball Game is a simple physics-based web application where:
- A black ball (radius 20px) moves on a white canvas (800x600px)
- User clicks on canvas to impart velocity to the ball
- Ball bounces off canvas edges
- Ball gradually slows down due to friction

## Mechanics

### Movement
- Ball starts at center (400, 300)
- Each click adds acceleration towards that point
- Velocity magnitude depends on click distance

### Physics
- Friction coefficient: 0.98 (98% retention per frame)
- Acceleration per click: 0.5 units per pixel distance
- Ball radius: 20 pixels
- Bounce energy loss: 10% (0.9 multiplier)

### Canvas Boundaries
- Width: 800px
- Height: 600px
- Ball bounces off all edges with energy loss

## Future Enhancements
- Multiple balls
- Gravity simulation
- Obstacle/wall placement
- Score/timer mechanics
