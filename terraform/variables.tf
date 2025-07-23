variable "aws_region" {
  description = "AWS region to deploy resources in"
  type        = string
  default     = "us-east-1"
}

variable "db_name" {
  description = "Database name for Postgres"
  type        = string
  default     = "video_insight"
}

variable "db_user" {
  description = "Database user for Postgres"
  type        = string
  default     = "postgres"
}

variable "db_password" {
  description = "Database password for Postgres"
  type        = string
  default     = "postgres"
  sensitive   = true
}

variable "s3_bucket_name" {
  description = "S3 bucket name for assets"
  type        = string
  default     = "video-insight-assets"
}

variable "openai_api_key" {
  description = "OpenAI API key for AI analysis"
  type        = string
  sensitive   = true
}

variable "jwt_secret" {
  description = "JWT secret for authentication"
  type        = string
  sensitive   = true
}

variable "ecr_image_url" {
  description = "ECR image URL for the API container"
  type        = string
}
