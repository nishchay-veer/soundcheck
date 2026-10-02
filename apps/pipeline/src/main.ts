#!/usr/bin/env node
import { createProgram } from "./cli";

await createProgram().parseAsync(process.argv);
