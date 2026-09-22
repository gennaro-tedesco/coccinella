# Development Instructions

Follow these rules for every code change in this repository.

## 1. Do Not Add Code Comments

- Do not add inline comments, block comments, TODO comments, or explanatory comments to source code.
- Make the code self-explanatory through clear naming and simple structure.
- Do not remove existing comments unless the requested change makes them incorrect or obsolete.

## 2. Reuse Existing Components

- Before creating a component, search the codebase for an existing component that provides the required behavior or structure.
- Reuse or compose existing components instead of duplicating their implementation.
- Extend an existing component only when the requested behavior belongs to that component and the change will not break its current consumers.
- Create a new component only when no existing component can reasonably satisfy the requirement.

## 3. Do Not Hardcode Values

- Do not place unexplained values directly in application logic or UI code.
- Store reusable values in appropriately named constants, configuration, theme tokens, or existing data structures.
- Reuse an existing constant or token before introducing a new one.
- Keep a value inline only when it is intrinsic to the language or API and naming it would not improve clarity, such as `0`, `1`, an empty string, or a boolean.

## 4. Use the Existing UI System

- Before implementing UI, inspect similar screens and components to identify the established UI patterns.
- Use the same shared UI components, design-system primitives, styling conventions, theme tokens, spacing, typography, colors, and interaction patterns already used throughout the application.
- Do not introduce a new UI library, custom replacement, or competing visual pattern when the application already provides an equivalent.
- Keep new UI visually and behaviorally consistent with the surrounding application.
