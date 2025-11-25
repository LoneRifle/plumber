import { randomUUID } from 'crypto'
import { beforeEach, describe, expect, it } from 'vitest'

import deleteFlowConnection from '@/graphql/mutations/delete-flow-connection'
import Connection from '@/models/connection'
import Flow from '@/models/flow'
import FlowConnections from '@/models/flow-connections'
import Step from '@/models/step'
import TableMetadata from '@/models/table-metadata'
import User from '@/models/user'
import Context from '@/types/express/context'

import { generateMockContext } from './tiles/table.mock'
import {
  generateMockCollaborator,
  generateMockFlow,
  generateMockStep,
  generateMockUser,
} from './flow.mock'

const createTilesStep = async (
  context: Context,
  flowId: string,
  tableId: string,
  position: number,
) => {
  return await generateMockStep(
    context,
    'createTileRow',
    'tiles',
    'action',
    flowId,
    position,
    { tableId, data: { name: 'test' } },
  )
}

describe('deleteFlowConnection', () => {
  let context: Context
  let testFlow: Flow
  let owner: User
  let editor: User
  let viewer: User
  let nonCollaborator: User
  let testConnection: Connection
  let testTable: TableMetadata
  let defaultInput: {
    flowId: string
    connectionId: string
    connectionType: 'connection' | 'table'
  }

  beforeEach(async () => {
    // Clear data
    await FlowConnections.query().delete()
    await Step.query().delete()
    await Flow.query().delete()
    await Connection.query().delete()
    await TableMetadata.query().delete()

    context = await generateMockContext()
    owner = context.currentUser
    editor = await generateMockUser('editor')
    viewer = await generateMockUser('viewer')
    nonCollaborator = await generateMockUser('nonCollaborator')

    testFlow = await generateMockFlow(context, randomUUID())

    await generateMockCollaborator(testFlow.id, editor.id, owner.id, 'editor')
    await generateMockCollaborator(testFlow.id, viewer.id, owner.id, 'viewer')

    // Create test connection
    testConnection = await Connection.query().insertAndFetch({
      userId: owner.id,
      key: 'slack',
      formattedData: { screenName: 'Test Slack' },
      verified: true,
    })

    // Create test table
    testTable = await TableMetadata.query().insertAndFetch({
      id: randomUUID(),
      name: 'Test Table',
      db: 'pg',
    })

    defaultInput = {
      flowId: testFlow.id,
      connectionId: testConnection.id,
      connectionType: 'connection',
    }
  })

  describe('only owner can delete flow connection', () => {
    it('should allow owner to delete flow connection', async () => {
      await FlowConnections.query().insert({
        flowId: testFlow.id,
        connectionId: testConnection.id,
        connectionType: 'connection',
        addedBy: owner.id,
      })

      const result = await deleteFlowConnection(
        null,
        { input: defaultInput },
        context,
      )

      expect(result).toBe(true)
    })

    it('should not allow editor to delete flow connection', async () => {
      context.currentUser = editor

      await expect(
        deleteFlowConnection(null, { input: defaultInput }, context),
      ).rejects.toThrow('You do not have access to this flow')
    })

    it('should not allow viewer to delete flow connection', async () => {
      context.currentUser = viewer

      await expect(
        deleteFlowConnection(null, { input: defaultInput }, context),
      ).rejects.toThrow('You do not have access to this flow')
    })

    it('should not allow nonCollaborator to delete flow connection', async () => {
      context.currentUser = nonCollaborator

      await expect(
        deleteFlowConnection(null, { input: defaultInput }, context),
      ).rejects.toThrow('You do not have access to this flow')
    })
  })

  describe('connection type: connection', () => {
    it('should delete connection and set connectionId to null for matching steps', async () => {
      // Create steps with this connection
      const step1 = await generateMockStep(
        context,
        'findMessage',
        'slack',
        'action',
        testFlow.id,
        1,
        { message: 'test' },
      )
      await Step.query().patchAndFetchById(step1.id, {
        connectionId: testConnection.id,
      })

      // Create step with different connection
      const otherConnection = await Connection.query().insertAndFetch({
        userId: owner.id,
        key: 'postman',
        formattedData: { screenName: 'Test Postman' },
        verified: true,
      })
      const step2 = await generateMockStep(
        context,
        'sendTransactionalEmail',
        'postman',
        'action',
        testFlow.id,
        2,
        { email: 'test@example.com' },
      )
      await Step.query().patchAndFetchById(step2.id, {
        connectionId: otherConnection.id,
      })

      await FlowConnections.query().insert({
        flowId: testFlow.id,
        connectionId: testConnection.id,
        connectionType: 'connection',
        addedBy: owner.id,
      })

      await deleteFlowConnection(null, { input: defaultInput }, context)

      // Check flow connection is deleted
      const flowConnection = await FlowConnections.query().findOne({
        flow_id: testFlow.id,
        connection_id: testConnection.id,
      })
      expect(flowConnection).toBeUndefined()

      // Check step1 connectionId is null
      const updatedStep1 = await Step.query().findById(step1.id)
      expect(updatedStep1.connectionId).toBeNull()

      // Check step2 connectionId is NOT affected
      const updatedStep2 = await Step.query().findById(step2.id)
      expect(updatedStep2.connectionId).toBe(otherConnection.id)
    })

    it('should not affect steps from other flows', async () => {
      const otherFlow = await generateMockFlow(context, randomUUID())

      // Create step in other flow with same connection
      const otherStep = await generateMockStep(
        context,
        'findMessage',
        'slack',
        'action',
        otherFlow.id,
        1,
        { message: 'test' },
      )
      await Step.query().patchAndFetchById(otherStep.id, {
        connectionId: testConnection.id,
      })

      await FlowConnections.query().insert({
        flowId: testFlow.id,
        connectionId: testConnection.id,
        connectionType: 'connection',
        addedBy: owner.id,
      })

      await deleteFlowConnection(null, { input: defaultInput }, context)

      // Check other flow's step is NOT affected
      const unchangedStep = await Step.query().findById(otherStep.id)
      expect(unchangedStep.connectionId).toBe(testConnection.id)
    })
  })

  describe('connection type: table', () => {
    it('should delete table connection and remove tableId from step parameters', async () => {
      const step1 = await createTilesStep(context, testFlow.id, testTable.id, 1)

      // Create step with different table
      const otherTable = await TableMetadata.query().insertAndFetch({
        id: randomUUID(),
        name: 'Other Table',
        db: 'pg',
      })

      const step2 = await createTilesStep(
        context,
        testFlow.id,
        otherTable.id,
        2,
      )

      await FlowConnections.query().insert({
        flowId: testFlow.id,
        connectionId: testTable.id,
        connectionType: 'table',
        addedBy: owner.id,
      })

      await deleteFlowConnection(
        null,
        {
          input: {
            flowId: testFlow.id,
            connectionType: 'table',
            connectionId: testTable.id,
          },
        },
        context,
      )

      // Check flow connection is deleted
      const flowConnection = await FlowConnections.query().findOne({
        flow_id: testFlow.id,
        connection_id: testTable.id,
      })
      expect(flowConnection).toBeUndefined()

      // Check step1 tableId is removed
      const updatedStep1 = await Step.query().findById(step1.id)
      expect(updatedStep1.parameters.tableId).toBeNull()
      expect(updatedStep1.parameters.data).toEqual({ name: 'test' })

      // Check step2 tableId is NOT affected
      const updatedStep2 = await Step.query().findById(step2.id)
      expect(updatedStep2.parameters.tableId).toBe(otherTable.id)
    })

    it('should only affect steps in the specified flow', async () => {
      const otherFlow = await generateMockFlow(context, randomUUID())

      // Create step in other flow with same table
      const otherStep = await createTilesStep(
        context,
        otherFlow.id,
        testTable.id,
        1,
      )

      await FlowConnections.query().insert({
        flowId: testFlow.id,
        connectionId: testTable.id,
        connectionType: 'table',
        addedBy: owner.id,
      })

      await deleteFlowConnection(
        null,
        {
          input: {
            flowId: testFlow.id,
            connectionType: 'table',
            connectionId: testTable.id,
          },
        },
        context,
      )

      // Check other flow's step is NOT affected
      const unchangedStep = await Step.query().findById(otherStep.id)
      expect(unchangedStep.parameters.tableId).toBe(testTable.id)
    })
  })
})
