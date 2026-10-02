# Data model

```text
customers/{customerId}
customers/{customerId}/profile/main
customers/{customerId}/cvs/{cvId}
customers/{customerId}/cvs/{cvId}/versions/{versionId}
customers/{customerId}/jobs/{jobId}
customers/{customerId}/applications/{applicationId}
customers/{customerId}/applications/{applicationId}/history/{historyId}
subscriptions/{customerId}
```

The customer ID is the verified Firebase Auth UID. The profile is the canonical career state: personal information, summary, skills, experience, education, projects, certifications, and links. CVs store a name and selected career item references; immutable version records hold a structured snapshot supplied by the assistant. Applications can reference a CV and version. Status transitions append history records. Jobs are provided by the user or assistant; Bravune does not scrape job sites.

Plans are `free` and `pro`; subscription status is held separately from the customer record. The MVP free limits default to three CVs and fifty applications and are configurable through environment variables.
