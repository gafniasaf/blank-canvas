---
description: Read the system-map.json to understand system capabilities and routes
---

# Read System Map

When the user asks about system capabilities, existing features, or requests new features, **ALWAYS** read the `system-map.json` file in the root directory first.

This file contains a machine-generated map of:
1. **Routes:** All active UI paths and their corresponding components.
2. **Capabilities:** All available pipeline jobs and edge functions.
3. **Entities:** The data model structure (BookRegistry, PipelineJob, PipelineEvent).

**Usage:**

1. Read `system-map.json`.
2. Search the `capabilities` array to see if the requested pipeline step already exists.
3. Search the `entities` array to see if the data model supports it.
4. **ONLY** propose a new feature if it is NOT present in the map.

**Example:**

User: "Add a glossary generation step."
Agent: *Reads system-map.json* -> Finds `generate_glossary` capability.
Agent: "The system already has a generate_glossary pipeline step. Do you want to modify it?"
