#!/usr/bin/env node
import { writeFileSync } from 'node:fs'

const target = process.argv.find(argument => argument.startsWith('--screenshot='))?.slice(13)
const url = process.argv.at(-1)
writeFileSync(target, Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(url)]))
