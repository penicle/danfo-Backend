import { MigrationBuilder } from 'node-pg-migrate'

export const shorthands = undefined

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.dropIndex('bonds', 'identity_address', { name: 'bonds_identity_address_idx', ifExists: true })
  pgm.dropIndex('attestations', 'subject_address', { name: 'attestations_subject_address_idx', ifExists: true })
  pgm.dropIndex('attestations', 'bond_id', { name: 'attestations_bond_id_idx', ifExists: true })
  pgm.dropIndex('slash_events', 'bond_id', { name: 'slash_events_bond_id_idx', ifExists: true })
  pgm.dropIndex('score_history', 'identity_address', { name: 'score_history_identity_address_idx', ifExists: true })

  pgm.createIndex('bonds', [
    'identity_address',
    { name: 'start_time', sort: 'DESC' },
    { name: 'id', sort: 'DESC' },
  ], {
    name: 'bonds_identity_start_time_idx',
    ifNotExists: true,
  })

  pgm.createIndex('attestations', [
    'subject_address',
    { name: 'created_at', sort: 'DESC' },
    { name: 'id', sort: 'DESC' },
  ], {
    name: 'attestations_subject_created_idx',
    ifNotExists: true,
  })

  pgm.createIndex('attestations', [
    'bond_id',
    { name: 'created_at', sort: 'DESC' },
    { name: 'id', sort: 'DESC' },
  ], {
    name: 'attestations_bond_created_idx',
    ifNotExists: true,
  })

  pgm.createIndex('slash_events', [
    'bond_id',
    { name: 'created_at', sort: 'DESC' },
    { name: 'id', sort: 'DESC' },
  ], {
    name: 'slash_events_bond_created_idx',
    ifNotExists: true,
  })

  pgm.createIndex('score_history', [
    'identity_address',
    { name: 'computed_at', sort: 'DESC' },
    { name: 'id', sort: 'DESC' },
  ], {
    name: 'score_history_identity_computed_idx',
    ifNotExists: true,
  })
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropIndex('bonds', [], { name: 'bonds_identity_start_time_idx', ifExists: true })
  pgm.dropIndex('attestations', [], { name: 'attestations_subject_created_idx', ifExists: true })
  pgm.dropIndex('attestations', [], { name: 'attestations_bond_created_idx', ifExists: true })
  pgm.dropIndex('slash_events', [], { name: 'slash_events_bond_created_idx', ifExists: true })
  pgm.dropIndex('score_history', [], { name: 'score_history_identity_computed_idx', ifExists: true })

  pgm.createIndex('bonds', 'identity_address', { name: 'bonds_identity_address_idx', ifNotExists: true })
  pgm.createIndex('attestations', 'subject_address', { name: 'attestations_subject_address_idx', ifNotExists: true })
  pgm.createIndex('attestations', 'bond_id', { name: 'attestations_bond_id_idx', ifNotExists: true })
  pgm.createIndex('slash_events', 'bond_id', { name: 'slash_events_bond_id_idx', ifNotExists: true })
  pgm.createIndex('score_history', 'identity_address', { name: 'score_history_identity_address_idx', ifNotExists: true })
}
