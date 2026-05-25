import { HealthcheckResponseSchema } from "../schemas/healthcheck.schema"

export const healthcheckDocSchema = {
    description: 'Verifica a saúde da API e conectividade com o banco de dados',
    tags: ['Health'],
    response: {
        200: HealthcheckResponseSchema,
        503: HealthcheckResponseSchema,
    }
}