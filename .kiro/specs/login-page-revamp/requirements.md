# Requirements Document

## Introduction

This feature revamps the login page of the JIRA Logwork desktop application (Svelte + Tauri). The new login page provides a visually appealing experience with an animated background, a credential form (Jira URL, Email, API Token), and automatic credential persistence so returning users can log in with a single click. Authentication is required before accessing any Jira-dependent functionality.

## Glossary

- **Login_Page**: The full-screen page displayed to unauthenticated users, containing the animated background and credential form
- **Credential_Store**: The Tauri plugin-store persistence layer (`settings.json`) that securely saves user credentials locally
- **Auth_Service**: The backend Tauri command (`test_connection`) that validates credentials against the Jira REST API
- **Animated_Background**: A CSS/SVG-based visual animation rendered behind the login form to enhance the visual experience
- **Credential_Form**: The input form containing Jira URL, Email, and API Token fields
- **App_Shell**: The main application layout containing navigation and page content, accessible only after successful authentication

## Requirements

### Requirement 1: Display Login Page for Unauthenticated Users

**User Story:** As a user, I want to see a login page when I open the app without saved credentials, so that I know I need to authenticate before using the application.

#### Acceptance Criteria

1. WHEN the application starts and any of the required credentials (Jira URL, Email, or API Token) are absent from the Credential_Store, THE Login_Page SHALL be displayed as the initial view within 2 seconds of application launch
2. WHILE the Login_Page is displayed, THE App_Shell SHALL not be rendered or accessible to the user
3. THE Login_Page SHALL occupy the full window area without displaying the App_Shell navigation bar or page-switching controls
4. WHILE the application is checking the Credential_Store on startup, THE Login_Page SHALL display a loading state until the credential check completes

### Requirement 2: Animated Background

**User Story:** As a user, I want to see a visually appealing animated background on the login page, so that the application feels polished and professional.

#### Acceptance Criteria

1. THE Login_Page SHALL render an Animated_Background that covers the full window area behind the Credential_Form
2. THE Animated_Background SHALL use CSS or SVG-based animations that do not require external asset downloads
3. THE Animated_Background SHALL maintain a frame rate of at least 30 frames per second as measured by browser rendering performance
4. IF the user has enabled a reduced-motion preference in their operating system, THEN THE Animated_Background SHALL disable or pause all animations and display a static background instead
5. THE Animated_Background SHALL provide sufficient visual contrast behind the Credential_Form so that all form labels, inputs, and button text remain legible

### Requirement 3: Credential Form Fields

**User Story:** As a user, I want to enter my Jira URL, email, and API token, so that the application can authenticate with my Jira instance.

#### Acceptance Criteria

1. THE Credential_Form SHALL display a labeled input field for the Jira base URL with placeholder text showing the expected URL format (e.g., "https://company.atlassian.net")
2. THE Credential_Form SHALL display a labeled input field for the user email address with an email-type input that indicates the expected format (e.g., "user@company.com")
3. THE Credential_Form SHALL display a labeled input field for the API token with masked text entry so that the token value is not visible on screen
4. THE Credential_Form SHALL display a "Login" button that initiates authentication
5. WHILE any required field (Jira URL, Email, or API Token) is empty or contains only whitespace characters, THE Credential_Form SHALL disable the Login button
6. IF the user clicks Login and the Jira URL field does not begin with "https://", THEN THE Credential_Form SHALL display an inline error message indicating the URL must be a valid HTTPS URL and SHALL NOT initiate authentication
7. IF the user clicks Login and the Email field does not contain a valid email format, THEN THE Credential_Form SHALL display an inline error message indicating the email format is invalid and SHALL NOT initiate authentication

### Requirement 4: Credential Persistence

**User Story:** As a returning user, I want my credentials to be remembered after a successful login, so that I do not need to re-enter them every time I open the application.

#### Acceptance Criteria

1. WHEN authentication succeeds, THE Credential_Store SHALL persist the Jira URL, email, and API token locally and confirm the write is complete before indicating success to the user
2. WHEN the application starts and all three credential fields (Jira URL, email, and API token) exist as non-empty values in the Credential_Store, THE Credential_Form SHALL pre-populate all fields with the stored values
3. WHEN the application starts and all three credential fields (Jira URL, email, and API token) exist as non-empty values in the Credential_Store, THE Login_Page SHALL display the Login button in an enabled state ready for one-click login
4. IF the application starts and the Credential_Store contains incomplete credentials (one or more fields are empty or missing), THEN THE Credential_Form SHALL pre-populate only the fields that have stored values and leave the remaining fields empty, and THE Login_Page SHALL display the Login button in a disabled state
5. IF the Credential_Store cannot be read on application start due to corruption or access failure, THEN THE Login_Page SHALL display the Credential_Form with all fields empty and the Login button disabled, without showing an error to the user

### Requirement 5: Authentication Flow

**User Story:** As a user, I want to validate my credentials against Jira when I click Login, so that I can confirm my access before entering the application.

#### Acceptance Criteria

1. WHEN the user clicks the Login button, THE Auth_Service SHALL send a validation request to the Jira REST API using the provided Jira URL, email, and API token, with a response timeout of 30 seconds
2. WHILE the Auth_Service is validating credentials, THE Login_Page SHALL display a loading indicator and disable the Login button
3. WHEN the Auth_Service returns a successful response, THE Login_Page SHALL display the authenticated user display name for 2 seconds before transitioning to the App_Shell
4. IF the Auth_Service does not receive a response within 30 seconds, THEN THE Login_Page SHALL cancel the request, re-enable the Login button, and display an error message indicating a connection timeout

### Requirement 6: Authentication Error Handling

**User Story:** As a user, I want to see clear error messages when login fails, so that I can correct my credentials and try again.

#### Acceptance Criteria

1. IF the Auth_Service returns an authentication error, THEN THE Login_Page SHALL display an error message indicating invalid credentials within 1 second of receiving the response
2. IF the Auth_Service returns a network error, THEN THE Login_Page SHALL display an error message indicating a connection problem within 1 second of receiving the response
3. IF authentication fails, THEN THE Credential_Form SHALL remain visible with the previously entered values intact and the Login button re-enabled so the user can correct and retry
4. IF authentication fails, THEN THE Login_Page SHALL hide the loading indicator and display the error message until the user initiates a new login attempt
5. IF the Auth_Service returns an error that is neither an authentication error nor a network error, THEN THE Login_Page SHALL display an error message indicating an unexpected problem occurred

### Requirement 7: Auto-Login for Returning Users

**User Story:** As a returning user with saved credentials, I want to log in with a single click without re-entering my credentials, so that I can quickly access the application.

#### Acceptance Criteria

1. WHEN the application starts and all three credential fields (Jira URL, Email, and API Token) exist in the Credential_Store, THE Login_Page SHALL display a message that includes the stored email address indicating saved credentials are available
2. WHEN the application starts and only partial credentials exist in the Credential_Store (e.g., Jira URL and Email but no API Token), THE Login_Page SHALL pre-populate only the available fields and SHALL NOT display the saved credentials message
3. WHEN the user clicks the Login button with pre-populated credentials, THE Auth_Service SHALL validate the stored credentials against the Jira API within 30 seconds
4. IF stored credentials fail validation due to an authentication error from the Jira API, THEN THE Login_Page SHALL clear the API token field, retain the Jira URL and Email values, and display a message indicating the token has expired or been revoked and must be re-entered

### Requirement 8: Logout Capability

**User Story:** As a user, I want to be able to log out of the application, so that I can switch accounts or secure my session.

#### Acceptance Criteria

1. WHILE the user is authenticated and viewing the App_Shell, THE App_Shell SHALL provide a logout action accessible from the navigation area
2. WHEN the user triggers the logout action, THE Credential_Store SHALL clear the stored API token while retaining the stored Jira URL and email
3. WHEN the user triggers the logout action, THE App_Shell SHALL navigate to the Login_Page within 1 second, displaying the Credential_Form with the Jira URL and email pre-populated and the API token field empty
4. IF the Credential_Store fails to clear the stored API token during logout, THEN THE App_Shell SHALL still navigate to the Login_Page and display an error message indicating the session could not be fully cleared
