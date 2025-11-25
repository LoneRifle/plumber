import { IApp } from '@/../../types'
import App from '@/models/app'
import FlowConnections from '@/models/flow-connections'

import { QueryResolvers } from '../__generated__/types.generated'

const getFlowConnections: QueryResolvers['getFlowConnections'] = async (
  _parent,
  params,
  context,
) => {
  const apps = await App.findAll()

  await context.currentUser.withAccessibleFlows({
    requiredRole: 'editor',
  })

  const rawFlowConnections = await FlowConnections.query()
    .where({
      flow_id: params.flowId,
    })
    .withGraphFetched({
      connection: true,
      user: true,
      table: true,
    })

  const filteredFlowConnections = rawFlowConnections.filter(
    (flowConnection) => flowConnection.connection || flowConnection.table,
  )

  const flowConnections = await Promise.all(
    filteredFlowConnections.map(async (flowConnection) => {
      let connectionName = flowConnection?.connection?.formattedData?.screenName
      if (flowConnection.connectionType === 'table') {
        connectionName = flowConnection.table?.name
      }

      let appKey = flowConnection.connection?.key
      if (flowConnection.connectionType === 'table') {
        appKey = 'tiles'
      }
      const app = apps.find((app: IApp) => app.key === appKey)

      return {
        flowId: flowConnection.flowId,
        connectionId: flowConnection.connectionId,
        connectionType: flowConnection.connectionType,
        addedBy: flowConnection?.user?.email || '',
        appName: app.name,
        appIconUrl: app.iconUrl,
        connectionName: connectionName as string,
      }
    }),
  )

  return flowConnections
}

export default getFlowConnections
