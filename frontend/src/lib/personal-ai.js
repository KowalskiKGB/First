export function personalAiGrants(connections, trainerId, studentId) {
  const connection = (connections || []).find(item => item?.status === 'active' && item.trainerId === trainerId && item.studentId === studentId)
  return {
    trainingProfileWrite: connection?.grants?.trainingProfileWrite === true,
    aiPlanRead: connection?.grants?.aiPlanRead === true,
  }
}
