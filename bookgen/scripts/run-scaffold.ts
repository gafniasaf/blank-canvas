#!/usr/bin/env node
import { scaffoldManifest } from "./lib/scaffold-system.js";
scaffoldManifest().catch((e) => { console.error(e); process.exit(1); });

