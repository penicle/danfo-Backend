import { MigrationBuilder } from 'node-pg-migrate'

const ANALYTICS_VIEW = 'analytics_metrics_mv'
const REFRESH_STATE_TABLE = 'analytics_view_refresh_state'

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createMaterializedView(
    ANALYTICS_VIEW,
    {},
    `
      SELECT
        1::integer AS metrics_key,
        COUNT(*) FILTER (WHERE i.active = true)::bigint AS active_identities,
        COUNT(*)::bigint AS total_identities,
        COALESCE(AVG(rs.total_score), 0)::numeric(20, 6) AS avg_total_score,
        COALESCE(MAX(rs.calculated_at), NOW()) AS latest_score_calculated_at,
        NOW() AS snapshot_at
      FROM identities i
      LEFT JOIN reputation_scores rs
        ON rs.address = i.address
    `,
  )

  // Required for REFRESH MATERIALIZED VIEW CONCURRENTLY.
  pgm.createIndex(ANALYTICS_VIEW, 'metrics_key', {
    name: 'analytics_metrics_mv_metrics_key_uidx',
    unique: true,
  })

  pgm.createTable(REFRESH_STATE_TABLE, {
    view_name: {
      type: 'text',
      primaryKey: true,
    },
    last_success_at: {
      type: 'timestamptz',
    },
    last_attempt_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('NOW()'),
    },
    last_error: {
      type: 'text',
    },
    duration_ms: {
      type: 'integer',
    },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('NOW()'),
    },
    updated_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('NOW()'),
    },
  })

  pgm.sql(`
    INSERT INTO ${REFRESH_STATE_TABLE} (view_name, last_success_at, last_attempt_at, last_error, duration_ms)
    VALUES ('${ANALYTICS_VIEW}', NOW(), NOW(), NULL, 0)
    ON CONFLICT (view_name) DO NOTHING;
  `)
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable(REFRESH_STATE_TABLE, { ifExists: true })
  pgm.dropMaterializedView(ANALYTICS_VIEW, { ifExists: true })
}

