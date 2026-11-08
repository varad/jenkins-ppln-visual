pipeline {
    agent any
    stages {
        stage('Prepare') { steps { echo 'prep' } }
        stage('Verify') {
            parallel {
                stage('Backend') {
                    stages {
                        stage('Compile') { steps { sh './gradlew compileJava' } }
                        stage('Integration') {
                            stages {
                                stage('Start DB') { steps { sh 'docker compose up -d db' } }
                                stage('IT tests') { steps { sh './gradlew integrationTest' } }
                            }
                            post { cleanup { sh 'docker compose down' } }
                        }
                    }
                }
                stage('Frontend') {
                    stages {
                        stage('Install') { steps { sh 'npm ci' } }
                        stage('Build UI') { steps { sh 'npm run build' } }
                    }
                }
                stage('Docs') { steps { sh 'mkdocs build' } }
            }
        }
        stage('Publish') { steps { echo 'publish' } }
    }
}
