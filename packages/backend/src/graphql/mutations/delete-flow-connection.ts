import logger from '@/helpers/logger'
import FlowConnections from '@/models/flow-connections'
import Step from '@/models/step'

import { MutationResolvers } from '../__generated__/types.generated'

const deleteFlowConnection: MutationResolvers['deleteFlowConnection'] = async (
  _parent,
  params,
  context,
) => {
  const { flowId, connectionId, connectionType } = params.input as {
    flowId: string
    connectionId: string
    connectionType: 'connection' | 'table'
  }

  try {
    return await FlowConnections.transaction(async (trx) => {
      // this user needs to first be a flow owner to delete the flow connection
      const flow = await context.currentUser
        .$relatedQuery('flows', trx)
        .findOne({
          id: flowId,
        })
        .throwIfNotFound({ message: 'You do not have access to this flow' })

      await FlowConnections.query(trx).delete().where({
        flow_id: flowId,
        connection_id: connectionId,
        connection_type: connectionType,
      })

      if (connectionType === 'connection') {
        // if its a connection, we patch the steps to remove the connection id
        await flow
          .$relatedQuery('steps', trx)
          .patch({ connectionId: null })
          .where({
            connection_id: connectionId,
            flow_id: flowId,
          })
      } else {
        // if its a tiles table, we need to remove the tableId from the step parameters
        await flow
          .$relatedQuery('steps', trx)
          .patch({
            parameters: Step.raw(`jsonb_set(parameters, ?, 'null'::jsonb)`, [
              '{tableId}',
            ]),
          })
          .where({ flow_id: flowId })
          .where(Step.raw('parameters->>? = ?', ['tableId', connectionId]))
      }

      return true
    })
  } catch (error) {
    console.error('error', error)
    logger.error({
      message: 'Failed to delete flow connection',
      data: {
        flowId,
        connectionId,
        error,
      },
    })
    throw new Error(error.message ?? 'Failed to delete flow connection')
  }
}

export default deleteFlowConnection
