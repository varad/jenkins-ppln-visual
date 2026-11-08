pipeline {
    agent { label 'linux' }
    environment { APP = 'web' }
    options { timeout(time: 30, unit: 'MINUTES') }
    parameters { booleanParam(name: 'DEPLOY', defaultValue: false) }
    stages {
        stage('Build') { steps { sh 'make build' } }
        stage('Test') {
            parallel {
                stage('Unit') { steps { sh 'make unit' } }
                stage('E2E') {
                    agent { docker { image 'node:20' } }
                    stages {
                        stage('Setup') { steps { sh 'npm ci' } }
                        stage('Run')   { steps { sh 'npm run e2e' } }
                    }
                }
            }
        }
        stage('Cross-platform') {
            matrix {
                axes {
                    axis { name 'OS';      values 'linux', 'windows' }
                    axis { name 'BROWSER'; values 'chrome', 'firefox' }
                }
                excludes { exclude { axis { name 'OS'; values 'windows' }
                                     axis { name 'BROWSER'; values 'firefox' } } }
                stages { stage('Smoke') { steps { echo "${OS}/${BROWSER}" } } }
            }
        }
        stage('Deploy') {
            when { allOf { branch 'main'; expression { params.DEPLOY } } }
            input { message 'Ship it?' }
            steps { sh './deploy.sh' }
        }
    }
    post {
        failure { mail to: 'team@example.com', subject: 'Build failed' }
        always  { junit '**/reports/*.xml' }
    }
}
