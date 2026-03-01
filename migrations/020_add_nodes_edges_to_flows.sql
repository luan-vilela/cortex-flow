-- Migration: adiciona nodes e edges (editor visual) à tabela flows e flow_templates
-- 2026-02-28

-- Grafo visual do flow (React Flow serializado)
ALTER TABLE flows
  ADD COLUMN IF NOT EXISTS nodes JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS edges JSONB DEFAULT '[]'::jsonb;

-- Grafo pré-montado do template (copiado para o flow ao instalar)
ALTER TABLE flow_templates
  ADD COLUMN IF NOT EXISTS template_nodes JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS template_edges JSONB DEFAULT '[]'::jsonb;

COMMENT ON COLUMN flows.nodes IS 'Nodes do editor visual (formato React Flow)';
COMMENT ON COLUMN flows.edges IS 'Edges do editor visual (formato React Flow)';
COMMENT ON COLUMN flow_templates.template_nodes IS 'Nodes pré-montados do template';
COMMENT ON COLUMN flow_templates.template_edges IS 'Edges pré-montados do template';
