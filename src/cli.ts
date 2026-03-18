#!/usr/bin/env node
import { Command } from "commander";

const program = new Command();
program.name("memex").description("Zettelkasten agent memory CLI").version("0.1.0");
program.parse();
