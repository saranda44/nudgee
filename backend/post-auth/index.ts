import { PostAuthenticationTriggerEvent, PostAuthenticationTriggerHandler } from 'aws-lambda';

export const handler: PostAuthenticationTriggerHandler = async (event: PostAuthenticationTriggerEvent) => {
  console.log("Post-Authentication para usuario:", event.userName);

  // TODO:
  // 1. Extraer sub, email y name de event.request.userAttributes
  // 2. UpdateItem (upsert) en PROFILE: SET email, name, lastLoginAt;
  //    if_not_exists en createdAt, timezone, locale y scheduleState = "NONE"
  // 3. Si la escritura a DynamoDB falla, no atrapar el error: debe propagarse
  //    para que Cognito bloquee el login
  // 4. Retornar el event sin modificar (Cognito lo exige en los triggers)

  return event;
};
