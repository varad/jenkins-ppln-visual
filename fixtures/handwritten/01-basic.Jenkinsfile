pipeline {
    agent any
    stages {
        stage('Checkout') { steps { checkout scm } }
        stage('Build') { steps { sh 'make build' } }
        stage('Test') { steps { sh 'make test' } }
        stage('Package') { steps { archiveArtifacts artifacts: 'dist/**', fingerprint: true } }
    }
}
