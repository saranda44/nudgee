# Documentación de Nudgee

Exportaciones de Notion, el espacio de trabajo original del proyecto. **Si un documento contradice al código, gana el código**: algunas versiones aquí son anteriores a decisiones ya implementadas.

| Documento | Versión | Contenido |
| --- | --- | --- |
| [descripcion-proyecto.md](descripcion-proyecto.md) | — | Problema, propuesta de valor, alcance del MVP |
| [requerimientos-funcionales.md](requerimientos-funcionales.md) | 1.4 | User stories (US-xx), categorías, estados y transiciones (T-xx), motor de recordatorios |
| [requerimientos-no-funcionales.md](requerimientos-no-funcionales.md) | 1.3 | Supuestos (S-xx), restricciones (C-xx), NFR-xx |
| [modelo-de-datos.md](modelo-de-datos.md) | 1.2 | DynamoDB single-table: decisiones (D-xx), entidades, patrones de acceso (AP-xx) |
| [contratos-api.md](contratos-api.md) | 1.1 | Decisiones (API-xx), endpoints E-01…E-21, catálogo de errores, payload de Web Push |
| [arquitectura.md](arquitectura.md) | 1.0 | Componentes, flujos, decisiones ARQ-xx, Well-Architected |
| [diseno-ux.md](diseno-ux.md) | 0.3 | Decisiones UX-xx/NTF-xx, pantallas (P-xx), overlays (O-xx), estados y errores por pantalla |
| [progreso.md](progreso.md) | — | Fases de implementación y cómo desplegar |

## Desfases conocidos con el código

Los documentos de la UX (v0.3) citan versiones más nuevas (RF v1.6, NFR v1.6, Modelo v1.5, Contratos v1.4, Arquitectura v1.2) que no están exportadas aquí. Cambios ya reflejados en el código:

- Sin ElastiCache/Redis ni VPC: deduplicación y cuota en una sola `TransactWriteItems` (ARQ-07).
- El schedule de recordatorios se crea una vez desde E-04 y no se pausa (NTF-02).
- Bandeja de recordatorios: E-22 `GET /v1/notifications` paginado (NTF-07); E-19 se dispara desde la push o la bandeja.

## Recursos externos

- Sistema de diseño: https://claude.ai/artifact/PAufV5Xs4ZqK1W4QvKpdzR
- Mockups (canvas): https://claude.ai/artifact/Euh4w8TGnENcemPxgHM2dH
- Diagrama de componentes (Lucid): ver [arquitectura.md](arquitectura.md) §2
