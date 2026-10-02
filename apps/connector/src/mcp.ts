import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { BravuneClient } from './client/bravune-client.js';

export function createBravuneMcpServer(api: BravuneClient) {
  const server = new McpServer({ name: 'bravune', version: '0.1.0' });
  const description = 'The AI assistant provides structured information to Bravune. Bravune validates, stores, organizes, and retrieves that information; it does not parse or analyze uploaded documents.';
  const result = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }] });

  server.tool('get_career_profile', description, {}, async () => result(await api.request('/v1/profile')));
  server.tool('update_career_profile', description, { profile: z.record(z.unknown()) }, async ({ profile }) => result(await api.request('/v1/profile', 'PATCH', profile)));
  for (const [singular, plural] of [['skill', 'skills'], ['experience_item', 'experience'], ['education_item', 'education'], ['project', 'projects'], ['certification', 'certifications']] as const) {
    server.tool(`list_${plural}`, description, {}, async () => result(await api.request(`/v1/${plural}`)));
    server.tool(`add_${singular}`, description, { value: z.record(z.unknown()) }, async ({ value }) => result(await api.request(`/v1/${plural}`, 'POST', value)));
    server.tool(`update_${singular}`, description, { id: z.string(), value: z.record(z.unknown()) }, async ({ id, value }) => result(await api.request(`/v1/${plural}/${id}`, 'PATCH', value)));
    server.tool(`remove_${singular}`, description, { id: z.string() }, async ({ id }) => result(await api.request(`/v1/${plural}/${id}`, 'DELETE')));
  }
  server.tool('list_cvs', description, {}, async () => result(await api.request('/v1/cvs')));
  server.tool('get_cv', description, { id: z.string() }, async ({ id }) => result(await api.request(`/v1/cvs/${id}`)));
  server.tool('create_cv', description, { name: z.string(), description: z.string().optional(), selectedItems: z.record(z.array(z.string())).optional() }, async input => result(await api.request('/v1/cvs', 'POST', input)));
  server.tool('update_cv', description, { id: z.string(), name: z.string(), description: z.string().optional(), selectedItems: z.record(z.array(z.string())).optional() }, async ({ id, ...input }) => result(await api.request(`/v1/cvs/${id}`, 'PATCH', input)));
  server.tool('create_cv_version', description, { id: z.string(), content: z.record(z.unknown()) }, async ({ id, content }) => result(await api.request(`/v1/cvs/${id}/versions`, 'POST', content)));
  server.tool('list_cv_versions', description, { id: z.string() }, async ({ id }) => result(await api.request(`/v1/cvs/${id}/versions`)));
  server.tool('get_cv_version', description, { id: z.string(), versionId: z.string() }, async ({ id, versionId }) => result(await api.request(`/v1/cvs/${id}/versions/${versionId}`)));
  server.tool('list_jobs', description, {}, async () => result(await api.request('/v1/jobs')));
  server.tool('get_job', description, { id: z.string() }, async ({ id }) => result(await api.request(`/v1/jobs/${id}`)));
  server.tool('create_job', description, { company: z.string(), title: z.string(), location: z.string().optional(), url: z.string().url().optional(), description: z.string().optional(), requirements: z.array(z.string()).optional(), notes: z.string().optional() }, async input => result(await api.request('/v1/jobs', 'POST', input)));
  server.tool('update_job', description, { id: z.string(), company: z.string().optional(), title: z.string().optional(), location: z.string().optional(), url: z.string().url().optional(), description: z.string().optional(), requirements: z.array(z.string()).optional(), salary: z.record(z.unknown()).optional(), notes: z.string().optional() }, async ({ id, ...input }) => result(await api.request(`/v1/jobs/${id}`, 'PATCH', input)));
  server.tool('list_applications', description, {}, async () => result(await api.request('/v1/applications')));
  server.tool('get_application', description, { id: z.string() }, async ({ id }) => result(await api.request(`/v1/applications/${id}`)));
  server.tool('create_application', description, { jobId: z.string(), cvId: z.string().optional(), cvVersionId: z.string().optional(), status: z.enum(['saved', 'applied', 'screening', 'interview', 'offer', 'rejected', 'withdrawn']).optional(), notes: z.string().optional() }, async input => result(await api.request('/v1/applications', 'POST', input)));
  server.tool('update_application', description, { id: z.string(), jobId: z.string().optional(), cvId: z.string().optional(), cvVersionId: z.string().optional(), status: z.enum(['saved', 'applied', 'screening', 'interview', 'offer', 'rejected', 'withdrawn']).optional(), notes: z.string().optional() }, async ({ id, ...input }) => result(await api.request(`/v1/applications/${id}`, 'PATCH', input)));
  server.tool('update_application_status', description, { id: z.string(), status: z.enum(['saved', 'applied', 'screening', 'interview', 'offer', 'rejected', 'withdrawn']), notes: z.string().optional() }, async ({ id, ...input }) => result(await api.request(`/v1/applications/${id}/status`, 'POST', input)));
  server.tool('get_application_history', description, { id: z.string() }, async ({ id }) => result(await api.request(`/v1/applications/${id}/history`)));

  // The installed MCP SDK version doesn't yet expose securitySchemes in its registration config.
  // Add the standard OAuth declaration to listTools output without changing any tool schema or handler.
  const handlers = (server.server as unknown as { _requestHandlers: Map<string, (request: unknown, extra: unknown) => Promise<{ tools: Array<Record<string, unknown>> }>> })._requestHandlers;
  const listTools = handlers.get('tools/list');
  if (listTools) {
    handlers.set('tools/list', async (request, extra) => {
      const result = await listTools(request, extra);
      return { ...result, tools: result.tools.map(tool => ({ ...tool, securitySchemes: [{ type: 'oauth2', scopes: ['bravune'] }] })) };
    });
  }
  return server;
}
