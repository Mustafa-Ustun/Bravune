import 'dotenv/config';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { BravuneClient } from './client/bravune-client.js';
import { createBravuneMcpServer } from './mcp.js';

const server = createBravuneMcpServer(new BravuneClient());
await server.connect(new StdioServerTransport());
